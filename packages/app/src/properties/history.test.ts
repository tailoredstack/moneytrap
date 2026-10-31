import { describe, expect, test } from "bun:test";
import { type Id, type IdKind, parseId } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type {
  PropertyReviewRecord,
  PropertyReviewStore,
  PropertyTransitionAudit,
} from "../ports/property-review-store";
import { readPropertyHistory } from "./history";

const propertyId = parseId("property", "prp_01arz3ndektsv4rrffq69g5fav") as Id<"property">;
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

function audit(action: PropertyTransitionAudit["action"], metadata: { reason?: string }, minute: number) {
  return {
    id: auditId,
    organizationId: orgId,
    actor: { type: "user", id: staffId },
    action,
    entityType: "property" as const,
    entityId: propertyId,
    metadata,
    occurredAt: new Date(`2026-10-31T10:${String(minute).padStart(2, "0")}:00.000Z`),
  } satisfies PropertyTransitionAudit;
}

// A suspended property with a full decision trail; the suspension and approval carry internal reviewer notes.
const trail = [
  audit("submit", {}, 1),
  audit("approve", { reason: "Internal: manual check passed" }, 2),
  audit("suspend", { reason: "Internal: fraud signal" }, 3),
];

class HistoryStore implements PropertyReviewStore {
  constructor(
    private readonly record: PropertyReviewRecord,
    private readonly rows: PropertyTransitionAudit[],
  ) {}

  async find(id: Id<"property">): Promise<PropertyReviewRecord | null> {
    return id === this.record.property.id ? this.record : null;
  }

  async recordTransition(): Promise<boolean> {
    throw new Error("history is read-only");
  }

  async auditTrail(organizationId: Id<"organization">, id: Id<"property">): Promise<PropertyTransitionAudit[]> {
    return this.rows.filter((row) => row.organizationId === organizationId && row.entityId === id);
  }
}

function suspendedStore(organizationId: Id<"organization"> = orgId) {
  const property = {
    id: propertyId,
    publisherId: parseId("publisher", "pub_01arz3ndektsv4rrffq69g5fav") as Id<"publisher">,
    type: "website" as const,
    canonicalIdentifier: "example.com",
    normalizedIdentifier: "example.com",
    status: "suspended" as const,
  };
  return new HistoryStore({ property, organizationId }, trail);
}

describe("property history (WP-3.7)", () => {
  test("TP-W3-020 staff reads the history of a suspended property with status and the decision trail", async () => {
    const result = await readPropertyHistory(ctxFor(staffId), suspendedStore(), {
      propertyId,
      organizationId: orgId,
      viewer: "staff",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected failure");
    expect(result.value.status).toBe("suspended");
    expect(result.value.entries.map((e) => e.action)).toEqual(["submit", "approve", "suspend"]);
    expect(result.value.entries[2]).toMatchObject({
      action: "suspend",
      actor: { type: "user", id: staffId },
      reason: "Internal: fraud signal",
    });
  });

  test("TP-W3-021 the publisher sees the suspended status and the trail, but no internal reviewer notes", async () => {
    const result = await readPropertyHistory(ctxFor(staffId), suspendedStore(), {
      propertyId,
      organizationId: orgId,
      viewer: "publisher",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected failure");
    expect(result.value.status).toBe("suspended");
    expect(result.value.entries.map((e) => e.action)).toEqual(["submit", "approve", "suspend"]);
    expect(JSON.stringify(result.value)).not.toContain("Internal");
    expect(JSON.stringify(result.value)).not.toContain(staffId);
  });

  test("the publisher sees the rejection reason, because the publisher is told why a property was rejected", async () => {
    const rejected = [audit("submit", {}, 1), audit("reject", { reason: "Site is parked" }, 2)];
    const rejectedStore = new HistoryStore(
      {
        property: {
          id: propertyId,
          publisherId: parseId("publisher", "pub_01arz3ndektsv4rrffq69g5fav") as Id<"publisher">,
          type: "website",
          canonicalIdentifier: "example.com",
          normalizedIdentifier: "example.com",
          status: "rejected",
          rejectionReason: "Site is parked",
        },
        organizationId: orgId,
      },
      rejected,
    );
    const result = await readPropertyHistory(ctxFor(staffId), rejectedStore, {
      propertyId,
      organizationId: orgId,
      viewer: "publisher",
    });
    expect(result.ok && result.value.entries[1]).toMatchObject({ action: "reject", reason: "Site is parked" });
  });

  test("a property owned by another organization is RESOURCE_NOT_FOUND and no trail is returned", async () => {
    const result = await readPropertyHistory(ctxFor(staffId), suspendedStore(otherOrgId), {
      propertyId,
      organizationId: orgId,
      viewer: "staff",
    });
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });

  test("an anonymous caller is UNAUTHENTICATED", async () => {
    const result = await readPropertyHistory(ctxFor(null), suspendedStore(), {
      propertyId,
      organizationId: orgId,
      viewer: "staff",
    });
    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });
});
