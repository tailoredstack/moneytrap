import { describe, expect, test } from "bun:test";
import { type Id, parseId } from "../ids/ids";
import {
  approvePublisher,
  draftPublisher,
  type Publisher,
  type PublisherTransition,
  reinstatePublisher,
  rejectPublisher,
  startPublisherReview,
  submitPublisher,
  suspendPublisher,
} from "./publisher";

const publisherId = parseId("publisher", "pub_00000000000000000000000000") as Id<"publisher">;

function draft() {
  return draftPublisher({ id: publisherId, legalName: "Acme Media Ltd" });
}

function apply(result: PublisherTransition): Publisher {
  if (!result.ok) throw new Error("fixture: transition failed");
  return result.value;
}

function inReview() {
  return apply(startPublisherReview(apply(submitPublisher(draft()))));
}

function approved() {
  return apply(approvePublisher(inReview()));
}

describe("Publisher state machine", () => {
  test("a new publisher starts as draft with its id and legal name", () => {
    expect(draft()).toEqual({ id: publisherId, legalName: "Acme Media Ltd", status: "draft" });
  });

  test("TP-W3-001 draft → submitted is allowed", () => {
    expect(submitPublisher(draft())).toEqual({
      ok: true,
      value: { id: publisherId, legalName: "Acme Media Ltd", status: "submitted" },
    });
  });

  test("TP-W3-002 draft → approved is rejected with STATE_CONFLICT", () => {
    expect(approvePublisher(draft())).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("submitted → in review → approved", () => {
    const submitted = apply(submitPublisher(draft()));
    expect(submitted.status).toBe("submitted");
    const reviewing = apply(startPublisherReview(submitted));
    expect(reviewing.status).toBe("in_review");
    expect(apply(approvePublisher(reviewing)).status).toBe("approved");
  });

  test("in review → rejected", () => {
    expect(apply(rejectPublisher(inReview())).status).toBe("rejected");
  });

  test("approved → suspended, and suspended → approved on reinstate", () => {
    const suspended = apply(suspendPublisher(approved()));
    expect(suspended.status).toBe("suspended");
    expect(apply(reinstatePublisher(suspended)).status).toBe("approved");
  });

  test("rejected is terminal for this lifecycle", () => {
    const rejected = apply(rejectPublisher(inReview()));
    expect(submitPublisher(rejected)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(approvePublisher(rejected)).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("illegal transitions are rejected with STATE_CONFLICT and leave the input untouched", () => {
    const start = draft();
    expect(startPublisherReview(start)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(rejectPublisher(start)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(suspendPublisher(start)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(reinstatePublisher(start)).toEqual({ ok: false, code: "STATE_CONFLICT" });

    const submitted = apply(submitPublisher(draft()));
    expect(submitPublisher(submitted)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(approvePublisher(submitted)).toEqual({ ok: false, code: "STATE_CONFLICT" });

    expect(suspendPublisher(inReview())).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(reinstatePublisher(approved())).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(start.status).toBe("draft");
  });
});
