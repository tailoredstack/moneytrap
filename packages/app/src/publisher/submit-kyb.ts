import { type Id, parseId, parseKybSubmission, startPublisherReview, submitPublisher } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { PublisherKybStore } from "../ports/publisher-kyb-store";

export type SubmitKybResult =
  | { ok: true; value: { kybId: Id<"kyb">; publisherId: Id<"publisher">; status: "in_review" } }
  | { ok: false; code: "UNAUTHENTICATED" }
  | { ok: false; code: "VALIDATION_FAILED"; reason: string }
  | { ok: false; code: "RESOURCE_NOT_FOUND" }
  | { ok: false; code: "STATE_CONFLICT" };

// Submits KYB for a draft publisher and moves it to in_review (API-022 outcome). The caller resolves which publisher
// the session owns and passes it in; the body is never trusted for ownership. Only a reference to the document is
// stored (DM-010), and neither the result nor the event carries it.
export async function submitKyb(
  ctx: Ctx,
  store: PublisherKybStore,
  publisherId: Id<"publisher">,
  raw: unknown,
): Promise<SubmitKybResult> {
  if (ctx.actor.type !== "user" || parseId("user", ctx.actor.id) === null)
    return { ok: false, code: "UNAUTHENTICATED" };

  const parsed = parseKybSubmission(raw);
  if (!parsed.ok) return { ok: false, code: "VALIDATION_FAILED", reason: parsed.reason };

  const publisher = await store.findPublisher(publisherId);
  if (!publisher) return { ok: false, code: "RESOURCE_NOT_FOUND" };

  // Both transitions are the domain's. Submission and review start together, so the publisher is in_review on return.
  // Only a publisher that is not draft fails here, and the domain reports that as STATE_CONFLICT.
  const submitted = submitPublisher(publisher);
  if (!submitted.ok) return { ok: false, code: "STATE_CONFLICT" };
  const inReview = startPublisherReview(submitted.value);
  if (!inReview.ok) return { ok: false, code: "STATE_CONFLICT" };

  const kybId = ctx.ids.next("kyb");
  const saved = await store.recordSubmission({
    expectedStatus: publisher.status,
    publisher: inReview.value,
    kyb: {
      id: kybId,
      publisherId,
      entityType: parsed.value.entityType,
      companyReference: parsed.value.companyReference,
      providerRef: parsed.value.documentReference,
      state: "in_review",
      createdAt: ctx.clock.now(),
    },
    event: {
      id: `publisher.submitted:${kybId}`,
      topic: "publisher.submitted",
      aggregateId: publisherId,
      aggregateVersion: 1,
      payload: { publisherId, kybId, state: "in_review" },
    },
  });
  if (!saved) return { ok: false, code: "STATE_CONFLICT" };

  return { ok: true, value: { kybId, publisherId, status: "in_review" } };
}
