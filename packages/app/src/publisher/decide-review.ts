import { approvePublisher, type Id, rejectPublisher } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { PublisherReviewStore } from "../ports/publisher-review-store";

export type DecideReviewResult =
  | { ok: true; value: { status: "approved" | "rejected" } }
  | { ok: false; code: "UNAUTHENTICATED" | "RESOURCE_NOT_FOUND" | "STATE_CONFLICT" }
  | { ok: false; code: "VALIDATION_FAILED"; reason: string };

export interface DecideReviewInput {
  publisherId: Id<"publisher">;
  // Taken from the authorized scope, never from the body, so a decision cannot reach another tenant's publisher.
  organizationId: Id<"organization">;
  body: unknown;
}

type ParsedDecision = { ok: true; decision: "approve" | "reject"; reason: string } | { ok: false; reason: string };

// A decision needs one of two verdicts and a non-blank reason. Anything else is VALIDATION_FAILED (TP-W3-005).
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

// Records a reviewer's verdict on a publisher in review. The status change and its audit row are one write,
// so the adapter commits both or neither (TP-W3-006). The guard has already checked publisher:review.
export async function decideReview(
  ctx: Ctx,
  store: PublisherReviewStore,
  input: DecideReviewInput,
): Promise<DecideReviewResult> {
  const actorId = ctx.actor.id;
  if (!actorId) return { ok: false, code: "UNAUTHENTICATED" };

  const parsed = parseDecision(input.body);
  if (!parsed.ok) return { ok: false, code: "VALIDATION_FAILED", reason: parsed.reason };

  const record = await store.find(input.publisherId);
  if (!record || record.organizationId !== input.organizationId) {
    return { ok: false, code: "RESOURCE_NOT_FOUND" };
  }

  const transition =
    parsed.decision === "approve" ? approvePublisher(record.publisher) : rejectPublisher(record.publisher);
  if (!transition.ok) return { ok: false, code: "STATE_CONFLICT" };

  await store.recordDecision({
    publisher: transition.value,
    audit: {
      id: ctx.ids.next("audit"),
      organizationId: input.organizationId,
      actor: { type: ctx.actor.type, id: actorId },
      action: parsed.decision,
      entityType: "publisher",
      entityId: input.publisherId,
      metadata: { reason: parsed.reason },
      occurredAt: ctx.clock.now(),
    },
  });

  return { ok: true, value: { status: parsed.decision === "approve" ? "approved" : "rejected" } };
}
