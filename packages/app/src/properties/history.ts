import type { Id, PropertyStatus } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { PropertyReviewStore, PropertyTransitionAudit } from "../ports/property-review-store";

export type PropertyHistoryResult =
  | { ok: true; value: { status: PropertyStatus; entries: PropertyHistoryEntry[] } }
  | { ok: false; code: "UNAUTHENTICATED" | "RESOURCE_NOT_FOUND" };

// Staff see who acted and the internal reason. The publisher sees the action and when it happened, plus the rejection
// reason, which the publisher is entitled to know. Internal reviewer notes never reach the publisher (TP-W3-021).
export type PropertyHistoryEntry =
  | {
      action: PropertyTransitionAudit["action"];
      occurredAt: Date;
      actor: { type: string; id: string };
      reason?: string;
    }
  | { action: PropertyTransitionAudit["action"]; occurredAt: Date; reason?: string };

export interface PropertyHistoryInput {
  propertyId: Id<"property">;
  // Taken from the authorized scope, never from the body.
  organizationId: Id<"organization">;
  // Set by the route from the caller's role. Staff may read the full trail; publishers get the public view.
  viewer: "staff" | "publisher";
}

// Reads a property's status and decision trail (TP-W3-020, TP-W3-021). Suspended properties stay readable.
export async function readPropertyHistory(
  ctx: Ctx,
  store: PropertyReviewStore,
  input: PropertyHistoryInput,
): Promise<PropertyHistoryResult> {
  if (!ctx.actor.id) return { ok: false, code: "UNAUTHENTICATED" };

  const record = await store.find(input.propertyId);
  if (!record || record.organizationId !== input.organizationId) {
    return { ok: false, code: "RESOURCE_NOT_FOUND" };
  }

  const rows = await store.auditTrail(input.organizationId, input.propertyId);
  const entries = rows.map((row): PropertyHistoryEntry => {
    if (input.viewer === "staff") {
      return {
        action: row.action,
        occurredAt: row.occurredAt,
        actor: row.actor,
        ...(row.metadata.reason ? { reason: row.metadata.reason } : {}),
      };
    }
    return {
      action: row.action,
      occurredAt: row.occurredAt,
      ...(row.action === "reject" && row.metadata.reason ? { reason: row.metadata.reason } : {}),
    };
  });

  return { ok: true, value: { status: record.property.status, entries } };
}
