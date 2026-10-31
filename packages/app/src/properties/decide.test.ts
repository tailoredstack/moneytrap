import { describe, expect, test } from "bun:test";
import {
  approveProperty,
  createWebsiteProperty,
  type Id,
  type IdKind,
  isMonetizable,
  markPropertyVerified,
  type Property,
  type PropertyStatus,
  parseId,
  requestPropertyVerification,
  submitPropertyForReview,
} from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type {
  PropertyReviewRecord,
  PropertyReviewStore,
  PropertyTransitionWrite,
} from "../ports/property-review-store";
import { decideProperty } from "./decide";
import { submitProperty } from "./submit";

const propertyId = parseId("property", "prp_01arz3ndektsv4rrffq69g5fav") as Id<"property">;
const publisherId = parseId("publisher", "pub_01arz3ndektsv4rrffq69g5fav") as Id<"publisher">;
const orgId = parseId("organization", "org_01arz3ndektsv4rrffq69g5fav") as Id<"organization">;
const otherOrgId = parseId("organization", "org_01bx5zzkbkactav9wevgemmvrz") as Id<"organization">;
const reviewerId = "usr_01arz3ndektsv4rrffq69g5fav";
const auditId = parseId("audit", "aud_01arz3ndektsv4rrffq69g5fav") as Id<"audit">;

const clock = { now: () => new Date("2026-10-31T10:20:00.000Z") };
const ids = {
  next<K extends IdKind>(_kind: K): Id<K> {
    return auditId as unknown as Id<K>;
  },
};

function ctxFor(actorId: string | null): Ctx {
  return { db: undefined as never, clock, ids, actor: { type: "user", id: actorId } };
}

// Builds a property at the given status through the domain state machine, so fixtures obey the real lifecycle.
function propertyIn(status: PropertyStatus): Property {
  const created = createWebsiteProperty({ id: propertyId, publisherId, canonicalIdentifier: "example.com" });
  if (!created.ok) throw new Error("fixture: create failed");
  if (status === "draft") return created.value;
  const pending = requestPropertyVerification(created.value);
  if (!pending.ok) throw new Error("fixture: request verification failed");
  if (status === "verification_pending") return pending.value;
  const verified = markPropertyVerified(pending.value);
  if (!verified.ok) throw new Error("fixture: mark verified failed");
  if (status === "verified") return verified.value;
  const review = submitPropertyForReview(verified.value);
  if (!review.ok) throw new Error("fixture: submit for review failed");
  if (status === "review_pending") return review.value;
  const approved = approveProperty(review.value);
  if (!approved.ok) throw new Error("fixture: approve failed");
  return approved.value;
}

// Models the adapter contract: the status and the audit row land together or neither does.
class MemoryPropertyStore implements PropertyReviewStore {
  records: PropertyReviewRecord[];
  writes: PropertyTransitionWrite[] = [];
  failAudit = false;

  constructor(record: PropertyReviewRecord) {
    this.records = [record];
  }

  async find(id: Id<"property">): Promise<PropertyReviewRecord | null> {
    return this.records.find((r) => r.property.id === id) ?? null;
  }

  async recordTransition(write: PropertyTransitionWrite): Promise<boolean> {
    const current = this.records.find((r) => r.property.id === write.property.id);
    if (current?.property.status !== write.expectedStatus) return false;
    if (this.failAudit) throw new Error("audit insert failed");
    this.records = this.records.map((r) =>
      r.property.id === write.property.id ? { ...r, property: write.property } : r,
    );
    this.writes.push(write);
    return true;
  }

  current(): Property | undefined {
    return this.records[0]?.property;
  }
}

function storeWith(status: PropertyStatus, organizationId = orgId): MemoryPropertyStore {
  return new MemoryPropertyStore({ property: propertyIn(status), organizationId });
}

const input = (body: unknown) => ({ propertyId, organizationId: orgId, body });

describe("decideProperty: reason is required", () => {
  test("an approval without a reason is refused with VALIDATION_FAILED and nothing is written", async () => {
    const store = storeWith("review_pending");
    const result = await decideProperty(ctxFor(reviewerId), store, input({ decision: "approve" }));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(store.writes).toHaveLength(0);
    expect(store.current()?.status).toBe("review_pending");
  });

  test("a rejection with a blank reason is refused with VALIDATION_FAILED", async () => {
    const store = storeWith("review_pending");
    const result = await decideProperty(ctxFor(reviewerId), store, input({ decision: "reject", reason: "   " }));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(store.writes).toHaveLength(0);
  });

  test("an unknown decision is refused with VALIDATION_FAILED", async () => {
    const store = storeWith("review_pending");
    const result = await decideProperty(ctxFor(reviewerId), store, input({ decision: "suspend", reason: "DNS ok" }));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(store.writes).toHaveLength(0);
  });
});

describe("decideProperty: compliance decision (TP-W3-016, TP-W3-017)", () => {
  test("TP-W3-016 a reviewer approves a property in review: it becomes approved and monetizable", async () => {
    const store = storeWith("review_pending");
    const result = await decideProperty(
      ctxFor(reviewerId),
      store,
      input({ decision: "approve", reason: " Site live " }),
    );

    expect(result).toEqual({ ok: true, value: { status: "approved" } });
    expect(store.current()?.status).toBe("approved");
    expect(isMonetizable(store.current()!)).toBe(true);
    expect(store.writes).toEqual([
      {
        expectedStatus: "review_pending",
        property: expect.objectContaining({ id: propertyId, status: "approved" }),
        audit: {
          id: auditId,
          organizationId: orgId,
          actor: { type: "user", id: reviewerId },
          action: "approve",
          entityType: "property",
          entityId: propertyId,
          metadata: { reason: "Site live" },
          occurredAt: clock.now(),
        },
      },
    ]);
  });

  test("TP-W3-017 a reviewer rejects a property in review: it is rejected with the reason and not monetizable", async () => {
    const store = storeWith("review_pending");
    const result = await decideProperty(
      ctxFor(reviewerId),
      store,
      input({ decision: "reject", reason: "Site is parked" }),
    );

    expect(result).toEqual({ ok: true, value: { status: "rejected" } });
    expect(store.current()).toEqual(expect.objectContaining({ status: "rejected", rejectionReason: "Site is parked" }));
    expect(isMonetizable(store.current()!)).toBe(false);
    expect(store.writes[0]?.audit).toEqual(
      expect.objectContaining({ action: "reject", metadata: { reason: "Site is parked" } }),
    );
  });

  test("a failing audit insert rolls the decision back: the property stays in review", async () => {
    const store = storeWith("review_pending");
    store.failAudit = true;

    await expect(
      decideProperty(ctxFor(reviewerId), store, input({ decision: "approve", reason: "Site live" })),
    ).rejects.toThrow("audit insert failed");
    expect(store.current()?.status).toBe("review_pending");
    expect(store.writes).toHaveLength(0);
  });

  test("a verified property that was never submitted cannot be approved and nothing is written", async () => {
    const store = storeWith("verified");
    const result = await decideProperty(ctxFor(reviewerId), store, input({ decision: "approve", reason: "Site live" }));

    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.writes).toHaveLength(0);
    expect(store.current()?.status).toBe("verified");
  });

  test("a property another writer moved after it was read is STATE_CONFLICT and nothing is written", async () => {
    const store = storeWith("review_pending");
    const stale = store.records[0]!;
    store.records = [{ ...stale, property: { ...stale.property, status: "suspended" } }];
    store.find = async () => stale;
    const result = await decideProperty(ctxFor(reviewerId), store, input({ decision: "approve", reason: "Site live" }));

    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.writes).toHaveLength(0);
  });
});

describe("decideProperty: scope and identity", () => {
  test("a property owned by another organization is RESOURCE_NOT_FOUND, not a decision", async () => {
    const store = new MemoryPropertyStore({ property: propertyIn("review_pending"), organizationId: otherOrgId });
    const result = await decideProperty(ctxFor(reviewerId), store, input({ decision: "approve", reason: "Site live" }));

    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(store.writes).toHaveLength(0);
  });

  test("a missing property is RESOURCE_NOT_FOUND", async () => {
    const store = storeWith("review_pending");
    store.records = [];
    const result = await decideProperty(ctxFor(reviewerId), store, input({ decision: "approve", reason: "Site live" }));

    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });

  test("an anonymous caller is UNAUTHENTICATED", async () => {
    const store = storeWith("review_pending");
    const result = await decideProperty(ctxFor(null), store, input({ decision: "approve", reason: "Site live" }));

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });
});

describe("verified is not approved (CT-006, end to end through submit and decide)", () => {
  test("a verified property is not monetizable until a reviewer approves it", async () => {
    const store = storeWith("verified");
    expect(isMonetizable(store.current()!)).toBe(false);

    const submitted = await submitProperty(ctxFor(reviewerId), store, { propertyId, organizationId: orgId });
    expect(submitted).toEqual({ ok: true, value: { status: "review_pending" } });
    expect(isMonetizable(store.current()!)).toBe(false);

    const approved = await decideProperty(
      ctxFor(reviewerId),
      store,
      input({ decision: "approve", reason: "Site live" }),
    );
    expect(approved).toEqual({ ok: true, value: { status: "approved" } });
    expect(isMonetizable(store.current()!)).toBe(true);
  });
});
