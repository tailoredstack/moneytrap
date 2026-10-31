import { describe, expect, test } from "bun:test";
import {
  draftPublisher,
  type Id,
  type IdKind,
  type Publisher,
  type PublisherStatus,
  parseId,
  startPublisherReview,
  submitPublisher,
} from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { PublisherReviewRecord, PublisherReviewStore, ReviewDecisionWrite } from "../ports/publisher-review-store";
import { decideReview } from "./decide-review";

const publisherId = parseId("publisher", "pub_01arz3ndektsv4rrffq69g5fav") as Id<"publisher">;
const orgId = parseId("organization", "org_01arz3ndektsv4rrffq69g5fav") as Id<"organization">;
const otherOrgId = parseId("organization", "org_01bx5zzkbkactav9wevgemmvrz") as Id<"organization">;
const reviewerId = "usr_01arz3ndektsv4rrffq69g5fav";
const auditId = parseId("audit", "aud_01arz3ndektsv4rrffq69g5fav") as Id<"audit">;

const clock = { now: () => new Date("2026-10-31T10:20:00.000Z") };
// Stub IDs keep assertions readable. Only audit IDs are generated in this action.
const ids = {
  next<K extends IdKind>(_kind: K): Id<K> {
    return auditId as unknown as Id<K>;
  },
};

function ctxFor(actorId: string | null): Ctx {
  return { db: undefined as never, clock, ids, actor: { type: "user", id: actorId } };
}

// Builds a publisher at the given status through the domain state machine, so fixtures obey the real lifecycle.
function publisherIn(status: PublisherStatus): Publisher {
  const draft = draftPublisher({ id: publisherId, legalName: "Acme Media Ltd" });
  if (status === "draft") return draft;
  const submitted = submitPublisher(draft);
  if (!submitted.ok) throw new Error("fixture: submit failed");
  if (status === "submitted") return submitted.value;
  const inReview = startPublisherReview(submitted.value);
  if (!inReview.ok) throw new Error("fixture: review start failed");
  return inReview.value;
}

// Models the adapter contract: the status and the audit row land together or neither does.
class MemoryReviewStore implements PublisherReviewStore {
  records: PublisherReviewRecord[];
  writes: ReviewDecisionWrite[] = [];
  findCalls = 0;
  failAudit = false;

  constructor(record: PublisherReviewRecord) {
    this.records = [record];
  }

  async find(id: Id<"publisher">): Promise<PublisherReviewRecord | null> {
    this.findCalls += 1;
    return this.records.find((r) => r.publisher.id === id) ?? null;
  }

  async recordDecision(write: ReviewDecisionWrite): Promise<boolean> {
    // Stage the status change, then fail before committing if the audit insert fails.
    const current = this.records.find((r) => r.publisher.id === write.publisher.id);
    if (current?.publisher.status !== write.expectedStatus) return false;
    const staged = { ...write.publisher };
    if (this.failAudit) throw new Error("audit insert failed");
    this.records = this.records.map((r) => (r.publisher.id === staged.id ? { ...r, publisher: staged } : r));
    this.writes.push(write);
    return true;
  }

  statusOf(): PublisherStatus | undefined {
    return this.records[0]?.publisher.status;
  }
}

function storeWith(status: PublisherStatus, organizationId = orgId): MemoryReviewStore {
  return new MemoryReviewStore({ publisher: publisherIn(status), organizationId });
}

const input = (body: unknown) => ({ publisherId, organizationId: orgId, body });

// Returns the value, or fails the test when it is missing, so a test never reads through a null.
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

describe("decideReview: reason is required (TP-W3-005)", () => {
  test("an approval without a reason is refused with VALIDATION_FAILED and nothing is written", async () => {
    const store = storeWith("in_review");
    const result = await decideReview(ctxFor(reviewerId), store, input({ decision: "approve" }));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(store.writes).toHaveLength(0);
    expect(store.statusOf()).toBe("in_review");
  });

  test("a blank reason counts as missing", async () => {
    const store = storeWith("in_review");
    const result = await decideReview(ctxFor(reviewerId), store, input({ decision: "reject", reason: "   " }));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(store.writes).toHaveLength(0);
  });

  test("an unknown decision is refused with VALIDATION_FAILED", async () => {
    const store = storeWith("in_review");
    const result = await decideReview(ctxFor(reviewerId), store, input({ decision: "suspend", reason: "DNS ok" }));

    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(store.writes).toHaveLength(0);
  });
});

describe("decideReview: approval and rejection (TP-W3-006)", () => {
  test("approving an in-review publisher sets it to approved and writes one audit row with the reason", async () => {
    const store = storeWith("in_review");
    const result = await decideReview(
      ctxFor(reviewerId),
      store,
      input({ decision: "approve", reason: " KYB matches " }),
    );

    expect(result).toEqual({ ok: true, value: { status: "approved" } });
    expect(store.statusOf()).toBe("approved");
    expect(store.writes).toEqual([
      {
        expectedStatus: "in_review",
        publisher: expect.objectContaining({ id: publisherId, status: "approved" }),
        audit: {
          id: auditId,
          organizationId: orgId,
          actor: { type: "user", id: reviewerId },
          action: "approve",
          entityType: "publisher",
          entityId: publisherId,
          metadata: { reason: "KYB matches" },
          occurredAt: clock.now(),
        },
      },
    ]);
  });

  test("rejecting an in-review publisher sets it to rejected", async () => {
    const store = storeWith("in_review");
    const result = await decideReview(ctxFor(reviewerId), store, input({ decision: "reject", reason: "KYB mismatch" }));

    expect(result).toEqual({ ok: true, value: { status: "rejected" } });
    expect(store.statusOf()).toBe("rejected");
  });

  test("a failing audit insert rolls the decision back: the publisher stays in review", async () => {
    const store = storeWith("in_review");
    store.failAudit = true;

    await expect(
      decideReview(ctxFor(reviewerId), store, input({ decision: "approve", reason: "DNS ok" })),
    ).rejects.toThrow("audit insert failed");
    expect(store.statusOf()).toBe("in_review");
    expect(store.writes).toHaveLength(0);
  });

  test("a publisher that another writer moved after it was read is STATE_CONFLICT and nothing is written", async () => {
    const store = storeWith("in_review");
    // Simulates a concurrent writer: this action reads the stale in_review snapshot, but the stored row has moved on.
    const stale = required(store.records[0]);
    store.records = [{ ...stale, publisher: { ...stale.publisher, status: "suspended" } }];
    store.find = async () => stale;
    const result = await decideReview(ctxFor(reviewerId), store, input({ decision: "approve", reason: "DNS ok" }));

    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.writes).toHaveLength(0);
  });

  test("a publisher that is not in review cannot be decided and nothing is written", async () => {
    const store = storeWith("submitted");
    const result = await decideReview(ctxFor(reviewerId), store, input({ decision: "approve", reason: "DNS ok" }));

    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.writes).toHaveLength(0);
    expect(store.statusOf()).toBe("submitted");
  });
});

describe("decideReview: scope and identity", () => {
  test("a publisher owned by another organization is RESOURCE_NOT_FOUND, not a decision", async () => {
    const store = storeWith("in_review", otherOrgId);
    const result = await decideReview(ctxFor(reviewerId), store, input({ decision: "approve", reason: "DNS ok" }));

    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(store.writes).toHaveLength(0);
  });

  test("a missing publisher is RESOURCE_NOT_FOUND", async () => {
    const store = new MemoryReviewStore({ publisher: publisherIn("in_review"), organizationId: orgId });
    store.records = [];
    const result = await decideReview(ctxFor(reviewerId), store, input({ decision: "approve", reason: "DNS ok" }));

    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });

  test("an anonymous caller is UNAUTHENTICATED before the body or store is touched", async () => {
    const store = storeWith("in_review");
    const result = await decideReview(ctxFor(null), store, input({ decision: "approve", reason: "DNS ok" }));

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(store.findCalls).toBe(0);
  });
});
