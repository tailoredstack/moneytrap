import { describe, expect, test } from "bun:test";
import {
  approveProperty,
  createWebsiteProperty,
  type Id,
  type IdKind,
  isMonetizable,
  markPropertyVerified,
  monetizationDenial,
  type Property,
  type PropertyStatus,
  parseId,
  requestPropertyVerification,
  submitPropertyForReview,
  suspendProperty as suspendTransition,
} from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type {
  PropertyReviewRecord,
  PropertyReviewStore,
  PropertyTransitionAudit,
  PropertyTransitionWrite,
} from "../ports/property-review-store";
import { reinstateProperty, suspendProperty } from "./suspend";

const propertyId = parseId("property", "prp_01arz3ndektsv4rrffq69g5fav") as Id<"property">;
const publisherId = parseId("publisher", "pub_01arz3ndektsv4rrffq69g5fav") as Id<"publisher">;
const orgId = parseId("organization", "org_01arz3ndektsv4rrffq69g5fav") as Id<"organization">;
const otherOrgId = parseId("organization", "org_01bx5zzkbkactav9wevgemmvrz") as Id<"organization">;
const staffId = "usr_01arz3ndektsv4rrffq69g5fav";
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
  if (status === "approved") return approved.value;
  const suspended = suspendTransition(approved.value);
  if (!suspended.ok) throw new Error("fixture: suspend failed");
  return suspended.value;
}

// Models the adapter contract: the status and the audit row land together or neither does.
class MemoryPropertyStore implements PropertyReviewStore {
  records: PropertyReviewRecord[];
  audits: PropertyTransitionAudit[] = [];
  writes: PropertyTransitionWrite[] = [];

  constructor(record: PropertyReviewRecord) {
    this.records = [record];
  }

  async find(id: Id<"property">): Promise<PropertyReviewRecord | null> {
    return this.records.find((r) => r.property.id === id) ?? null;
  }

  async recordTransition(write: PropertyTransitionWrite): Promise<boolean> {
    this.writes.push(write);
    const current = this.records.find((r) => r.property.id === write.property.id);
    if (current?.organizationId !== write.expectedOrganizationId) return false;
    if (current?.property.status !== write.expectedStatus) return false;
    this.records = this.records.map((r) =>
      r.property.id === write.property.id ? { ...r, property: write.property } : r,
    );
    this.audits.push(write.audit);
    return true;
  }

  async auditTrail(organizationId: Id<"organization">, id: Id<"property">): Promise<PropertyTransitionAudit[]> {
    return this.audits.filter((a) => a.organizationId === organizationId && a.entityId === id);
  }
}

function storeWith(status: PropertyStatus, organizationId: Id<"organization"> = orgId) {
  return new MemoryPropertyStore({ property: propertyIn(status), organizationId });
}

// Returns the value, or fails the test when it is missing, so a test never reads through a null.
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

describe("suspension (WP-3.7)", () => {
  test("TP-W3-018 suspending an approved property sets it suspended and writes the status and audit row together", async () => {
    const store = storeWith("approved");
    const result = await suspendProperty(ctxFor(staffId), store, { propertyId, organizationId: orgId });

    expect(result).toEqual({ ok: true, value: { status: "suspended" } });
    expect(store.records[0]?.property.status).toBe("suspended");
    expect(isMonetizable(required(store.records[0]).property)).toBe(false);
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({ action: "suspend", entityId: propertyId, organizationId: orgId });
  });

  test("TP-W3-019 a suspended property is denied monetization immediately, with the not approved reason", async () => {
    const store = storeWith("approved");
    await suspendProperty(ctxFor(staffId), store, { propertyId, organizationId: orgId });
    expect(monetizationDenial(required(store.records[0]).property)).toBe("not approved");
  });

  test("an optional suspension reason is recorded in the audit metadata", async () => {
    const store = storeWith("approved");
    await suspendProperty(ctxFor(staffId), store, { propertyId, organizationId: orgId, reason: "Chargeback review" });
    expect(store.audits[0]?.metadata).toEqual({ reason: "Chargeback review" });
  });

  test("only an approved property can be suspended: a property in review is STATE_CONFLICT and nothing is written", async () => {
    const store = storeWith("review_pending");
    const result = await suspendProperty(ctxFor(staffId), store, { propertyId, organizationId: orgId });
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.writes).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });

  test("a property owned by another organization is RESOURCE_NOT_FOUND and nothing is written", async () => {
    const store = storeWith("approved", otherOrgId);
    const result = await suspendProperty(ctxFor(staffId), store, { propertyId, organizationId: orgId });
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(store.writes).toHaveLength(0);
  });

  test("an anonymous caller is UNAUTHENTICATED", async () => {
    const store = storeWith("approved");
    const result = await suspendProperty(ctxFor(null), store, { propertyId, organizationId: orgId });
    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(store.writes).toHaveLength(0);
  });

  test("a property that moved after it was read is STATE_CONFLICT and nothing is written", async () => {
    const store = storeWith("approved");
    const original = store.recordTransition.bind(store);
    store.recordTransition = async (write) => {
      store.records = store.records.map((r) => ({ ...r, property: { ...r.property, status: "rejected" } }));
      return original(write);
    };
    const result = await suspendProperty(ctxFor(staffId), store, { propertyId, organizationId: orgId });
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.audits).toHaveLength(0);
  });
});

describe("reinstatement (WP-3.7)", () => {
  function suspendedStore(organizationId: Id<"organization"> = orgId) {
    return storeWith("suspended", organizationId);
  }

  test("TP-W3-022 reinstating with a reason sets the property approved again and writes an audit row", async () => {
    const store = suspendedStore();
    const result = await reinstateProperty(ctxFor(staffId), store, {
      propertyId,
      organizationId: orgId,
      reason: "Content fixed",
    });

    expect(result).toEqual({ ok: true, value: { status: "approved" } });
    expect(isMonetizable(required(store.records[0]).property)).toBe(true);
    expect(store.audits[0]).toMatchObject({ action: "reinstate", organizationId: orgId });
    expect(store.audits[0]?.metadata).toEqual({ reason: "Content fixed" });
  });

  test("a reinstatement without a reason is VALIDATION_FAILED and nothing is written", async () => {
    const store = suspendedStore();
    const result = await reinstateProperty(ctxFor(staffId), store, { propertyId, organizationId: orgId, reason: "  " });
    expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED", reason: "reason is required" });
    expect(store.writes).toHaveLength(0);
  });

  test("only a suspended property can be reinstated: an approved one is STATE_CONFLICT", async () => {
    const store = storeWith("approved");
    const result = await reinstateProperty(ctxFor(staffId), store, { propertyId, organizationId: orgId, reason: "x" });
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.writes).toHaveLength(0);
  });

  test("a property owned by another organization is RESOURCE_NOT_FOUND", async () => {
    const store = suspendedStore(otherOrgId);
    const result = await reinstateProperty(ctxFor(staffId), store, { propertyId, organizationId: orgId, reason: "x" });
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(store.writes).toHaveLength(0);
  });

  test("an anonymous caller is UNAUTHENTICATED", async () => {
    const store = suspendedStore();
    const result = await reinstateProperty(ctxFor(null), store, { propertyId, organizationId: orgId, reason: "x" });
    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });
});
