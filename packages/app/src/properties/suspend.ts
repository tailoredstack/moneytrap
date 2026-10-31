import {
  type Id,
  reinstateProperty as reinstateTransition,
  suspendProperty as suspendTransition,
} from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { PropertyReviewStore } from "../ports/property-review-store";

export type SuspendPropertyResult =
  | { ok: true; value: { status: "suspended" } }
  | { ok: false; code: "UNAUTHENTICATED" | "RESOURCE_NOT_FOUND" | "STATE_CONFLICT" };

export type ReinstatePropertyResult =
  | { ok: true; value: { status: "approved" } }
  | { ok: false; code: "UNAUTHENTICATED" | "RESOURCE_NOT_FOUND" | "STATE_CONFLICT" }
  | { ok: false; code: "VALIDATION_FAILED"; reason: string };

export interface SuspendPropertyInput {
  propertyId: Id<"property">;
  // Taken from the authorized scope, never from the body, so a suspension cannot reach another tenant's property.
  organizationId: Id<"organization">;
  // Optional. Kept in the audit row so staff can see why, but not required: suspension is a safety stop.
  reason?: string;
}

export interface ReinstatePropertyInput {
  propertyId: Id<"property">;
  organizationId: Id<"organization">;
  reason: string;
}

// Stops monetization of an approved property (UC08, CT-007). The status change and its audit row are one write, so
// the property is no longer monetizable in the same transaction that suspends it (TP-W3-018).
export async function suspendProperty(
  ctx: Ctx,
  store: PropertyReviewStore,
  input: SuspendPropertyInput,
): Promise<SuspendPropertyResult> {
  const actorId = ctx.actor.id;
  if (!actorId) return { ok: false, code: "UNAUTHENTICATED" };

  const record = await store.find(input.propertyId);
  if (!record || record.organizationId !== input.organizationId) {
    return { ok: false, code: "RESOURCE_NOT_FOUND" };
  }

  const transition = suspendTransition(record.property);
  if (!transition.ok) return { ok: false, code: "STATE_CONFLICT" };

  const applied = await store.recordTransition({
    expectedOrganizationId: input.organizationId,
    expectedStatus: record.property.status,
    property: transition.value,
    audit: {
      id: ctx.ids.next("audit"),
      organizationId: input.organizationId,
      actor: { type: ctx.actor.type, id: actorId },
      action: "suspend",
      entityType: "property",
      entityId: input.propertyId,
      metadata: input.reason?.trim() ? { reason: input.reason.trim() } : {},
      occurredAt: ctx.clock.now(),
    },
  });
  // Another writer moved the property after it was read. Nothing was written, so the caller must reload and retry.
  if (!applied) return { ok: false, code: "STATE_CONFLICT" };

  return { ok: true, value: { status: "suspended" } };
}

// Restores a suspended property to approved (TP-W3-022). A reinstatement must say why, so the audit trail has the reason.
export async function reinstateProperty(
  ctx: Ctx,
  store: PropertyReviewStore,
  input: ReinstatePropertyInput,
): Promise<ReinstatePropertyResult> {
  const actorId = ctx.actor.id;
  if (!actorId) return { ok: false, code: "UNAUTHENTICATED" };

  const reason = input.reason.trim();
  if (reason === "") return { ok: false, code: "VALIDATION_FAILED", reason: "reason is required" };

  const record = await store.find(input.propertyId);
  if (!record || record.organizationId !== input.organizationId) {
    return { ok: false, code: "RESOURCE_NOT_FOUND" };
  }

  const transition = reinstateTransition(record.property);
  if (!transition.ok) return { ok: false, code: "STATE_CONFLICT" };

  const applied = await store.recordTransition({
    expectedOrganizationId: input.organizationId,
    expectedStatus: record.property.status,
    property: transition.value,
    audit: {
      id: ctx.ids.next("audit"),
      organizationId: input.organizationId,
      actor: { type: ctx.actor.type, id: actorId },
      action: "reinstate",
      entityType: "property",
      entityId: input.propertyId,
      metadata: { reason },
      occurredAt: ctx.clock.now(),
    },
  });
  if (!applied) return { ok: false, code: "STATE_CONFLICT" };

  return { ok: true, value: { status: "approved" } };
}
