import { type Id, submitPropertyForReview } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { PropertyReviewStore } from "../ports/property-review-store";

export type SubmitPropertyResult =
  | { ok: true; value: { status: "review_pending" } }
  | { ok: false; code: "UNAUTHENTICATED" | "RESOURCE_NOT_FOUND" | "STATE_CONFLICT" };

export interface SubmitPropertyInput {
  propertyId: Id<"property">;
  // Taken from the authorized scope, never from the body, so a submission cannot reach another tenant's property.
  organizationId: Id<"organization">;
}

// Sends a verified property to compliance review (UC08, API-029). Verification alone does not make a property
// monetizable; only the reviewer's approval does (CT-006). The guard has already checked the publisher's permission.
export async function submitProperty(
  ctx: Ctx,
  store: PropertyReviewStore,
  input: SubmitPropertyInput,
): Promise<SubmitPropertyResult> {
  const actorId = ctx.actor.id;
  if (!actorId) return { ok: false, code: "UNAUTHENTICATED" };

  const record = await store.find(input.propertyId);
  if (!record || record.organizationId !== input.organizationId) {
    return { ok: false, code: "RESOURCE_NOT_FOUND" };
  }

  const transition = submitPropertyForReview(record.property);
  if (!transition.ok) return { ok: false, code: "STATE_CONFLICT" };

  const applied = await store.recordTransition({
    expectedOrganizationId: input.organizationId,
    expectedStatus: record.property.status,
    property: transition.value,
    audit: {
      id: ctx.ids.next("audit"),
      organizationId: input.organizationId,
      actor: { type: ctx.actor.type, id: actorId },
      action: "submit",
      entityType: "property",
      entityId: input.propertyId,
      metadata: {},
      occurredAt: ctx.clock.now(),
    },
  });
  // Another writer moved the property after it was read. Nothing was written, so the caller must reload and retry.
  if (!applied) return { ok: false, code: "STATE_CONFLICT" };

  return { ok: true, value: { status: "review_pending" } };
}
