import { approveProperty, type Id, rejectProperty } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { PropertyReviewStore } from "../ports/property-review-store";

export type DecidePropertyResult =
  | { ok: true; value: { status: "approved" | "rejected" } }
  | { ok: false; code: "UNAUTHENTICATED" | "RESOURCE_NOT_FOUND" | "STATE_CONFLICT" }
  | { ok: false; code: "VALIDATION_FAILED"; reason: string };

export interface DecidePropertyInput {
  propertyId: Id<"property">;
  // Taken from the authorized scope, never from the body, so a decision cannot reach another tenant's property.
  organizationId: Id<"organization">;
  body: unknown;
}

type ParsedDecision = { ok: true; decision: "approve" | "reject"; reason: string } | { ok: false; reason: string };

// A decision needs one of two verdicts and a non-blank reason, for approvals as well as rejections, so the audit trail
// always says why (TP-W3-016, TP-W3-017).
function parseDecision(body: unknown): ParsedDecision {
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const decision = raw.decision;
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, reason: "decision must be approve or reject" };
  }
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (reason === "") return { ok: false, reason: "reason is required" };
  return { ok: true, decision, reason };
}

// Records a reviewer's compliance verdict on a property in review (UC08, API-030). Only an approved property becomes
// monetizable (CT-006). The status change and its audit row are one write, so the adapter commits both or neither.
export async function decideProperty(
  ctx: Ctx,
  store: PropertyReviewStore,
  input: DecidePropertyInput,
): Promise<DecidePropertyResult> {
  const actorId = ctx.actor.id;
  if (!actorId) return { ok: false, code: "UNAUTHENTICATED" };

  const parsed = parseDecision(input.body);
  if (!parsed.ok) return { ok: false, code: "VALIDATION_FAILED", reason: parsed.reason };

  const record = await store.find(input.propertyId);
  if (!record || record.organizationId !== input.organizationId) {
    return { ok: false, code: "RESOURCE_NOT_FOUND" };
  }

  const transition =
    parsed.decision === "approve" ? approveProperty(record.property) : rejectProperty(record.property, parsed.reason);
  if (!transition.ok) return { ok: false, code: "STATE_CONFLICT" };

  const applied = await store.recordTransition({
    expectedOrganizationId: input.organizationId,
    expectedStatus: record.property.status,
    property: transition.value,
    audit: {
      id: ctx.ids.next("audit"),
      organizationId: input.organizationId,
      actor: { type: ctx.actor.type, id: actorId },
      action: parsed.decision,
      entityType: "property",
      entityId: input.propertyId,
      metadata: { reason: parsed.reason },
      occurredAt: ctx.clock.now(),
    },
  });
  // Another writer moved the property after it was read. Nothing was written, so the caller must reload and retry.
  if (!applied) return { ok: false, code: "STATE_CONFLICT" };

  return { ok: true, value: { status: parsed.decision === "approve" ? "approved" : "rejected" } };
}
