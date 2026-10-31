import { describe, expect, test } from "bun:test";
import { decideProperty } from "@moneytrap/app/src/properties/decide";
import { readPropertyHistory } from "@moneytrap/app/src/properties/history";
import { submitProperty } from "@moneytrap/app/src/properties/submit";
import { suspendProperty } from "@moneytrap/app/src/properties/suspend";
import { requestPropertyChallenge, verifyProperty } from "@moneytrap/app/src/properties/verify";
import { decideReview } from "@moneytrap/app/src/publisher/decide-review";
import {
  draftPublisher,
  type Id,
  monetizationDenial,
  type Principal,
  type Scope,
  startPublisherReview,
  submitPublisher,
} from "@moneytrap/domain";
import {
  FakeClock,
  FakeDnsResolver,
  FakeIdGenerator,
  FakePropertyReviewStore,
  FakePropertyStore,
  FakePublisherReviewStore,
  FakeVerificationTokens,
  fixtureCtx,
  fixtureId,
} from "@moneytrap/test-kit";

// Milestone M2 (wave 3): publisher and property approval. Each case drives the in-process app layer (the same actions
// the routes will call) with the test-kit fakes, because the publisher and property HTTP routes and the Postgres
// property review adapter do not exist yet. The gate under test is the domain's monetizationDenial, which link create
// (WP-5.2) calls before it creates a link.

const orgId = fixtureId("organization", 1) as Id<"organization">;
const ownerId = fixtureId("user", 1) as Id<"user">;
const reviewerId = fixtureId("user", 2) as Id<"user">;
const publisherId = fixtureId("publisher", 1) as Id<"publisher">;
const propertyId = fixtureId("property", 1) as Id<"property">;
const principal: Principal = { userId: ownerId, memberships: [{ organizationId: orgId, role: "owner" }] };
const scope: Scope = { organizationId: orgId };

// One world per case: a publisher that is approved (so only the property decides monetization) and a draft website property.
async function approvedPublisherWithDraftProperty() {
  const clock = new FakeClock();
  const ids = new FakeIdGenerator();
  const owner = fixtureCtx(undefined as never, { clock, ids, actor: { type: "user", id: ownerId } });
  const reviewer = fixtureCtx(undefined as never, { clock, ids, actor: { type: "user", id: reviewerId } });

  const publishers = new FakePublisherReviewStore();
  const draft = draftPublisher({ id: publisherId, legalName: "Example Media Ltd" });
  const submitted = submitPublisher(draft);
  if (!submitted.ok) throw new Error("fixture: submit publisher failed");
  const inReview = startPublisherReview(submitted.value);
  if (!inReview.ok) throw new Error("fixture: start publisher review failed");
  publishers.records = [{ publisher: inReview.value, organizationId: orgId }];
  const approved = await decideReview(reviewer, publishers, {
    publisherId,
    organizationId: orgId,
    body: { decision: "approve", reason: "KYB documents checked" },
  });
  if (!approved.ok) throw new Error("fixture: approve publisher failed");

  const properties = new FakePropertyStore();
  const dns = new FakeDnsResolver();
  const tokens = new FakeVerificationTokens();
  properties.seed({
    id: propertyId,
    publisherId,
    type: "website",
    canonicalIdentifier: "example.com",
    normalizedIdentifier: "example.com",
    status: "draft",
    organizationId: orgId,
    version: 0,
  });

  return { owner, reviewer, dns, tokens, properties, reviews: new FakePropertyReviewStore(), clock };
}

// Verifies the property through the DNS challenge (WP-3.5), then hands the verified row to the review store (WP-3.6).
// The verification store and the review store are separate ports, so the fixture copies the row across.
async function verifyAndHandOff(world: Awaited<ReturnType<typeof approvedPublisherWithDraftProperty>>) {
  const deps = { store: world.properties, dns: world.dns, tokens: world.tokens };
  const challenge = await requestPropertyChallenge(world.owner, deps, {
    principal,
    scope,
    propertyId,
    method: "dns",
  });
  if (!challenge.ok) throw new Error("fixture: request challenge failed");
  world.dns.setTxt(challenge.value.recordName, [challenge.value.challengeText]);

  const verified = await verifyProperty(world.owner, deps, { principal, scope, propertyId });
  if (!verified.ok) throw new Error("fixture: verify failed");

  const stored = await world.properties.find(scope, propertyId);
  if (!stored) throw new Error("fixture: property missing after verification");
  world.reviews.records = [{ property: stored, organizationId: orgId }];
}

describe("[M2] publisher conformance", () => {
  test("[M2][M4] CT-006 verified but unapproved property: monetized link created", async () => {
    const world = await approvedPublisherWithDraftProperty();
    await verifyAndHandOff(world);

    // Verified means the publisher owns the site. It is not approved, so the link create gate must refuse it.
    const verified = world.reviews.records[0]!.property;
    expect(verified.status).toBe("verified");
    expect(monetizationDenial(verified)).toBe("not approved");

    const submitted = await submitProperty(world.owner, world.reviews, { propertyId, organizationId: orgId });
    expect(submitted).toEqual({ ok: true, value: { status: "review_pending" } });
    expect(monetizationDenial(world.reviews.records[0]!.property)).toBe("not approved");

    const decided = await decideProperty(world.reviewer, world.reviews, {
      propertyId,
      organizationId: orgId,
      body: { decision: "approve", reason: "Site live and compliant" },
    });
    expect(decided).toEqual({ ok: true, value: { status: "approved" } });
    expect(monetizationDenial(world.reviews.records[0]!.property)).toBeNull();
  });

  test("[M2] CT-007 approved publisher/property: reviewer suspends property", async () => {
    const world = await approvedPublisherWithDraftProperty();
    await verifyAndHandOff(world);
    await submitProperty(world.owner, world.reviews, { propertyId, organizationId: orgId });
    await decideProperty(world.reviewer, world.reviews, {
      propertyId,
      organizationId: orgId,
      body: { decision: "approve", reason: "Site live and compliant" },
    });
    expect(monetizationDenial(world.reviews.records[0]!.property)).toBeNull();

    const suspended = await suspendProperty(world.reviewer, world.reviews, {
      propertyId,
      organizationId: orgId,
      reason: "Ad policy breach under review",
    });
    expect(suspended).toEqual({ ok: true, value: { status: "suspended" } });

    // New monetization is blocked in the same write that suspends the property, so the next link create sees it.
    expect(world.reviews.records[0]!.property.status).toBe("suspended");
    expect(monetizationDenial(world.reviews.records[0]!.property)).toBe("not approved");

    // Staff can still read the suspended property's history, including who suspended it and why.
    const staff = await readPropertyHistory(world.reviewer, world.reviews, {
      propertyId,
      organizationId: orgId,
      viewer: "staff",
    });
    expect(staff.ok).toBe(true);
    if (!staff.ok) return;
    expect(staff.value.status).toBe("suspended");
    expect(staff.value.entries.map((entry) => entry.action)).toEqual(["submit", "approve", "suspend"]);
    expect(staff.value.entries.at(-1)).toMatchObject({
      action: "suspend",
      actor: { type: "user", id: reviewerId },
      reason: "Ad policy breach under review",
    });

    // The publisher sees the suspension, but not the reviewer's internal reason.
    const publisher = await readPropertyHistory(world.owner, world.reviews, {
      propertyId,
      organizationId: orgId,
      viewer: "publisher",
    });
    expect(publisher.ok).toBe(true);
    if (!publisher.ok) return;
    expect(publisher.value.status).toBe("suspended");
    expect(publisher.value.entries.at(-1)).toEqual({ action: "suspend", occurredAt: expect.any(Date) });
  });
});
