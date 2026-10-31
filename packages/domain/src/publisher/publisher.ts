import type { ErrorCode } from "../errors/codes";
import type { Id } from "../ids/ids";

// Publisher lifecycle from spec §5 (Publisher) and UC06. Only `approved` publishers may monetize.
export const PUBLISHER_STATUSES = ["draft", "submitted", "in_review", "approved", "rejected", "suspended"] as const;

export type PublisherStatus = (typeof PUBLISHER_STATUSES)[number];

export interface Publisher {
  readonly id: Id<"publisher">;
  readonly legalName: string;
  readonly status: PublisherStatus;
}

export type PublisherTransition = { ok: true; value: Publisher } | { ok: false; code: ErrorCode };

export function draftPublisher(input: { id: Id<"publisher">; legalName: string }): Publisher {
  return { id: input.id, legalName: input.legalName, status: "draft" };
}

export function submitPublisher(publisher: Publisher): PublisherTransition {
  return move(publisher, "draft", "submitted");
}

export function startPublisherReview(publisher: Publisher): PublisherTransition {
  return move(publisher, "submitted", "in_review");
}

export function approvePublisher(publisher: Publisher): PublisherTransition {
  return move(publisher, "in_review", "approved");
}

// A rejected publisher is terminal in this lifecycle. Resubmission is not modelled yet.
export function rejectPublisher(publisher: Publisher): PublisherTransition {
  return move(publisher, "in_review", "rejected");
}

export function suspendPublisher(publisher: Publisher): PublisherTransition {
  return move(publisher, "approved", "suspended");
}

// Reinstating a suspended publisher restores it to approved (TP-W3-022).
export function reinstatePublisher(publisher: Publisher): PublisherTransition {
  return move(publisher, "suspended", "approved");
}

// Every transition returns a new value. An illegal move is a STATE_CONFLICT and leaves the input untouched.
function move(publisher: Publisher, from: PublisherStatus, to: PublisherStatus): PublisherTransition {
  if (publisher.status !== from) return { ok: false, code: "STATE_CONFLICT" };
  return { ok: true, value: { ...publisher, status: to } };
}
