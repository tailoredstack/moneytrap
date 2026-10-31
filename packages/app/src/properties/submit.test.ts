import { describe, expect, test } from "bun:test";
import {
  createWebsiteProperty,
  type Id,
  type IdKind,
  markPropertyVerified,
  type Property,
  type PropertyStatus,
  parseId,
  requestPropertyVerification,
} from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type {
  PropertyReviewRecord,
  PropertyReviewStore,
  PropertyTransitionWrite,
} from "../ports/property-review-store";
import { submitProperty } from "./submit";

const propertyId = parseId("property", "prp_01arz3ndektsv4rrffq69g5fav") as Id<"property">;
const publisherId = parseId("publisher", "pub_01arz3ndektsv4rrffq69g5fav") as Id<"publisher">;
const orgId = parseId("organization", "org_01arz3ndektsv4rrffq69g5fav") as Id<"organization">;
const otherOrgId = parseId("organization", "org_01bx5zzkbkactav9wevgemmvrz") as Id<"organization">;
const actorId = "usr_01arz3ndektsv4rrffq69g5fav";
const auditId = parseId("audit", "aud_01arz3ndektsv4rrffq69g5fav") as Id<"audit">;

const clock = { now: () => new Date("2026-10-31T10:20:00.000Z") };
const ids = {
  next<K extends IdKind>(_kind: K): Id<K> {
    return auditId as unknown as Id<K>;
  },
};

function ctxFor(id: string | null): Ctx {
  return { db: undefined as never, clock, ids, actor: { type: "user", id } };
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
  return verified.value;
}

// Models the adapter contract: the status and the audit row land together or neither does.
class MemoryPropertyStore implements PropertyReviewStore {
  records: PropertyReviewRecord[];
  writes: PropertyTransitionWrite[] = [];
  findCalls = 0;

  constructor(record: PropertyReviewRecord) {
    this.records = [record];
  }

  async find(id: Id<"property">): Promise<PropertyReviewRecord | null> {
    this.findCalls += 1;
    return this.records.find((r) => r.property.id === id) ?? null;
  }

  async recordTransition(write: PropertyTransitionWrite): Promise<boolean> {
    const current = this.records.find((r) => r.property.id === write.property.id);
    if (current?.organizationId !== write.expectedOrganizationId) return false;
    if (current?.property.status !== write.expectedStatus) return false;
    this.records = this.records.map((r) =>
      r.property.id === write.property.id ? { ...r, property: write.property } : r,
    );
    this.writes.push(write);
    return true;
  }

  statusOf(): PropertyStatus | undefined {
    return this.records[0]?.property.status;
  }
}

function storeWith(status: PropertyStatus, organizationId = orgId): MemoryPropertyStore {
  return new MemoryPropertyStore({ property: propertyIn(status), organizationId });
}

const input = { propertyId, organizationId: orgId };

describe("submitProperty: a verified property goes to review (TP-W3-014)", () => {
  test("TP-W3-014 submitting a verified property moves it to review pending and writes one audit row", async () => {
    const store = storeWith("verified");
    const result = await submitProperty(ctxFor(actorId), store, input);

    expect(result).toEqual({ ok: true, value: { status: "review_pending" } });
    expect(store.statusOf()).toBe("review_pending");
    expect(store.writes).toEqual([
      {
        expectedOrganizationId: orgId,
        expectedStatus: "verified",
        property: expect.objectContaining({ id: propertyId, status: "review_pending" }),
        audit: {
          id: auditId,
          organizationId: orgId,
          actor: { type: "user", id: actorId },
          action: "submit",
          entityType: "property",
          entityId: propertyId,
          metadata: {},
          occurredAt: clock.now(),
        },
      },
    ]);
  });

  test("a property that is only verification pending cannot be submitted and nothing is written", async () => {
    const store = storeWith("verification_pending");
    const result = await submitProperty(ctxFor(actorId), store, input);

    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.writes).toHaveLength(0);
    expect(store.statusOf()).toBe("verification_pending");
  });

  test("a draft property cannot skip verification and nothing is written", async () => {
    const store = storeWith("draft");
    const result = await submitProperty(ctxFor(actorId), store, input);

    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.writes).toHaveLength(0);
  });

  test("a property another writer moved after it was read is STATE_CONFLICT and nothing is written", async () => {
    const store = storeWith("verified");
    const stale = store.records[0]!;
    store.records = [{ ...stale, property: { ...stale.property, status: "rejected" } }];
    store.find = async () => stale;
    const result = await submitProperty(ctxFor(actorId), store, input);

    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.writes).toHaveLength(0);
  });

  test("a property owned by another organization is RESOURCE_NOT_FOUND, not a submission", async () => {
    const store = storeWith("verified", otherOrgId);
    const result = await submitProperty(ctxFor(actorId), store, input);

    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(store.writes).toHaveLength(0);
  });

  test("a missing property is RESOURCE_NOT_FOUND", async () => {
    const store = storeWith("verified");
    store.records = [];
    const result = await submitProperty(ctxFor(actorId), store, input);

    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });

  test("an anonymous caller is UNAUTHENTICATED before the store is touched", async () => {
    const store = storeWith("verified");
    const result = await submitProperty(ctxFor(null), store, input);

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(store.findCalls).toBe(0);
  });

  test("a property that moves to another organization after it was read writes nothing (tenant race)", async () => {
    const store = storeWith("verified");
    const stale = store.records[0]!;
    // The read sees the caller's organization, but the stored row has moved to another tenant with the same status.
    store.records = [{ ...stale, organizationId: otherOrgId }];
    store.find = async () => stale;
    const result = await submitProperty(ctxFor(actorId), store, input);

    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.writes).toHaveLength(0);
  });
});
