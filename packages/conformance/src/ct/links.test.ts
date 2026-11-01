import { describe, expect, test } from "bun:test";
import { recordClick } from "@moneytrap/app/src/attribution/record-click";
import type { Ctx } from "@moneytrap/app/src/ctx";
import { createActiveLink, type LinkDeps, revokeLinkAction } from "@moneytrap/app/src/links/link-actions";
import type { RouteSource } from "@moneytrap/app/src/ports/route-source";
import { resolveRedirect } from "@moneytrap/app/src/routing/redirect";
import {
  approveProperty,
  createWebsiteProperty,
  type EligibilityDecision,
  type Id,
  markPropertyVerified,
  type Property,
  type PropertyStatus,
  requestPropertyVerification,
  submitPropertyForReview,
  suspendProperty,
} from "@moneytrap/domain";
import {
  FakeClickQueue,
  FakeClickStore,
  FakeClock,
  FakeIdGenerator,
  FakePropertyReviewStore,
  FakeRouteCache,
  fixtureCtx,
  fixtureId,
} from "@moneytrap/test-kit";
import { FakeLinkStore } from "@moneytrap/test-kit/src/fakes/link-store";

// Milestone M4 (wave 5): links, redirect, and click trace. Each case drives the in-process app layer (the link actions,
// the redirect use case, and the click recorder) with the test-kit fakes, because the link HTTP routes do not exist yet.
// The redirect route itself is covered by the server's own tests (apps/server/src/http/redirect.test.ts).

const orgId = fixtureId("organization", 1) as Id<"organization">;
const userId = fixtureId("user", 1) as Id<"user">;
const publisherId = fixtureId("publisher", 1) as Id<"publisher">;
const propertyId = fixtureId("property", 1) as Id<"property">;
const programId = fixtureId("program", 1) as Id<"program">;
const DESTINATION = "https://shop.example.com/offer";
const ALLOWED_HOSTS = ["shop.example.com"];
const ALLOW: EligibilityDecision = { decision: "allow", policyVersion: 1, checks: [] };
const DENY: EligibilityDecision = { decision: "deny", policyVersion: 2, reasons: ["geography"], checks: [] };

// The property at a given status, reached through the domain state machine so the fixture obeys the real lifecycle.
function propertyIn(status: PropertyStatus): Property {
  const created = createWebsiteProperty({ id: propertyId, publisherId, canonicalIdentifier: "example.com" });
  if (!created.ok) throw new Error("fixture: create failed");
  if (status === "draft") return created.value;
  const pending = requestPropertyVerification(created.value);
  if (!pending.ok) throw new Error("fixture: request failed");
  if (status === "verification_pending") return pending.value;
  const verified = markPropertyVerified(pending.value);
  if (!verified.ok) throw new Error("fixture: verify failed");
  if (status === "verified") return verified.value;
  const review = submitPropertyForReview(verified.value);
  if (!review.ok) throw new Error("fixture: submit failed");
  if (status === "review_pending") return review.value;
  const approved = approveProperty(review.value);
  if (!approved.ok) throw new Error("fixture: approve failed");
  if (status === "approved") return approved.value;
  const suspended = suspendProperty(approved.value);
  if (!suspended.ok) throw new Error("fixture: suspend failed");
  return suspended.value;
}

// A cache whose version publish is lost after the write commits. ADR-007 rule 1 bounds that stale view by the freshness window.
class LossyPublishCache extends FakeRouteCache {
  override async publishVersion(): Promise<void> {}
}

// One world per case: an approved program that allows the host, and a property at the given status, both in one org.
function world(status: PropertyStatus = "approved", cache: FakeRouteCache = new FakeRouteCache()) {
  const clock = new FakeClock("2026-11-01T10:00:00.000Z");
  const ids = new FakeIdGenerator();
  const links = new FakeLinkStore();
  const properties = new FakePropertyReviewStore();
  properties.records = [{ property: propertyIn(status), organizationId: orgId }];
  links.setPropertyStatus(orgId, propertyId, status);
  links.setAllowedHosts(programId, ALLOWED_HOSTS);
  links.setEligibility(orgId, propertyId, programId, ALLOW);
  const deps: LinkDeps = { links, properties, policy: links, routeCache: cache };
  const ctx: Ctx = fixtureCtx(undefined as never, { clock, ids, actor: { type: "user", id: userId } });
  return { clock, links, cache, deps, ctx, clicks: new FakeClickQueue() };
}

// The primary as the redirect reads it: the stored link, and whether its latest eligibility decision allows it.
function primary(links: FakeLinkStore): RouteSource {
  return {
    async findByToken(token) {
      const row = links.rows.get(token);
      if (!row) return null;
      const decision = await links.latestEligibility(row.organizationId, row.link.propertyId, row.programId);
      const allowedHosts = await links.allowedHosts(row.organizationId, row.programId);
      return { link: row.link, eligible: decision?.decision === "allow", allowedHosts };
    },
  };
}

function redirectDeps(w: ReturnType<typeof world>) {
  return {
    cache: w.cache,
    source: primary(w.links),
    clicks: w.clicks,
    clock: w.clock,
    onClickError: () => {},
  };
}

// The redirect's click is enqueued after the decision, in the background, so a test lets that step run first.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function createLink(w: ReturnType<typeof world>): Promise<string> {
  const created = await createActiveLink(w.ctx, w.deps, {
    organizationId: orgId,
    propertyId,
    programId,
    destination: DESTINATION,
  });
  if (!created.ok) throw new Error(`fixture: link create refused with ${created.code}`);
  return created.value.id;
}

describe("[M4] link conformance", () => {
  test("[M2][M4] CT-006 verified or suspended property: monetized link is not created", async () => {
    for (const status of ["verified", "suspended"] as const) {
      const w = world(status);
      const created = await createActiveLink(w.ctx, w.deps, {
        organizationId: orgId,
        propertyId,
        programId,
        destination: DESTINATION,
      });

      expect(created).toEqual({ ok: false, code: "STATE_CONFLICT", reason: "property_not_approved" });
      expect(w.links.rows.size).toBe(0);
    }
  });

  test("[M4] CT-010 offer not permitted in user country or channel: link not created for an ineligible program", async () => {
    const w = world();
    w.links.setEligibility(orgId, propertyId, programId, DENY);

    const created = await createActiveLink(w.ctx, w.deps, {
      organizationId: orgId,
      propertyId,
      programId,
      destination: DESTINATION,
    });

    expect(created).toEqual({ ok: false, code: "PROGRAM_INELIGIBLE", reasons: ["geography"] });
    expect(w.links.rows.size).toBe(0);
  });

  test("[M4] CT-010 offer not permitted in user country or channel: a link resolves to denied once its program turns ineligible", async () => {
    const w = world();
    const linkId = await createLink(w);
    await resolveRedirectOnce(w, linkId, "req-1");
    expect(await resolveRedirectOnce(w, linkId, "req-2")).toEqual({ kind: "redirect", destination: DESTINATION });

    // The eligibility change is not published to the cache, so the view stays allowed until the freshness bound passes.
    w.links.setEligibility(orgId, propertyId, programId, DENY);
    w.cache.now += 3000;

    expect(await resolveRedirectOnce(w, linkId, "req-3")).toEqual({ kind: "denied" });
  });

  test("[M4] CT-013 click emitted twice: analytics ingests duplicate", async () => {
    const w = world();
    const linkId = await createLink(w);
    await resolveRedirectOnce(w, linkId, "req-1");
    const [job] = w.clicks.enqueued();
    if (!job) throw new Error("fixture: no click was enqueued");

    // The same click is delivered twice (a redelivered job). The store keeps one fact for the dedup key.
    const clickStore = new FakeClickStore();
    expect(await recordClick(clickStore, job)).toBe("recorded");
    expect(await recordClick(clickStore, job)).toBe("duplicate");
    expect(clickStore.recorded()).toHaveLength(1);
  });

  test("[M4] CT-013 distinct legitimate clicks are kept: two clicks one second apart both record", async () => {
    const w = world();
    const linkId = await createLink(w);
    await resolveRedirectOnce(w, linkId, "req-1");
    w.clock.advance({ seconds: 1 });
    await resolveRedirectOnce(w, linkId, "req-2");

    const clickStore = new FakeClickStore();
    for (const job of w.clicks.enqueued()) {
      expect(await recordClick(clickStore, job)).toBe("recorded");
    }
    expect(clickStore.recorded()).toHaveLength(2);
  });

  test("[M4] CT-014 link revoked while route view stale: redirect attempted", async () => {
    const w = world();
    const linkId = await createLink(w);
    expect(await resolveRedirectOnce(w, linkId, "req-1")).toEqual({ kind: "redirect", destination: DESTINATION });

    // The cache now holds an allow view at the active version. The revoke publishes the new version, so that view is stale.
    const revoked = await revokeLinkAction(w.ctx, w.deps, { organizationId: orgId, linkId });
    expect(revoked).toMatchObject({ ok: true, value: { status: "revoked" } });

    expect(await resolveRedirectOnce(w, linkId, "req-2")).toEqual({ kind: "denied" });
    expect(w.clicks.enqueued()).toHaveLength(1);
  });

  test("[M4] CT-014 revocation takes effect within 5 seconds even when its version publish is lost", async () => {
    const cache = new LossyPublishCache();
    const w = world("approved", cache);
    const linkId = await createLink(w);
    expect(await resolveRedirectOnce(w, linkId, "req-1")).toEqual({ kind: "redirect", destination: DESTINATION });

    // The publish never reached the cache, so the stale allow still answers inside the freshness window.
    const revoked = await revokeLinkAction(w.ctx, w.deps, { organizationId: orgId, linkId });
    expect(revoked).toMatchObject({ ok: true, value: { status: "revoked" } });
    expect(await resolveRedirectOnce(w, linkId, "req-2")).toEqual({ kind: "redirect", destination: DESTINATION });

    // Once the cached view ages past the three-second bound, the source answers and the revoked link is denied (5 s guarantee).
    cache.now += 3000;
    expect(await resolveRedirectOnce(w, linkId, "req-3")).toEqual({ kind: "denied" });
  });

  // The destination re-check at redirect time (WP-5.7, OZE-3166) is not merged, so CT-011 cannot be activated in this package yet.
  test.todo("[M4] CT-011 destination redirects to unsafe host: visitor opens link");
});

// Runs one redirect against the world and lets its background click enqueue finish.
async function resolveRedirectOnce(w: ReturnType<typeof world>, linkId: string, requestId: string) {
  const result = await resolveRedirect(redirectDeps(w), linkId, requestId);
  await settle();
  return result;
}
