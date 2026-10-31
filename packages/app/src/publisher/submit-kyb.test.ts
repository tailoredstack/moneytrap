import { describe, expect, test } from "bun:test";
import { draftPublisher, type Id, type IdKind, type Publisher } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { KybSubmissionWrite, PublisherKybStore } from "../ports/publisher-kyb-store";
import { submitKyb } from "./submit-kyb";

const actorId = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const publisherId = "pub_01arz3ndektsv4rrffq69g5fav" as Id<"publisher">;
const kybId = "kyb_01arz3ndektsv4rrffq69g5fav" as Id<"kyb">;

// Stub IDs keep assertions readable. Each kind gets a fixed, prefixed value.
const ids = {
  next<K extends IdKind>(kind: K): Id<K> {
    return `${kind === "kyb" ? "kyb" : kind}_01arz3ndektsv4rrffq69g5fav` as Id<K>;
  },
};

const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

function ctxFor(actor: Ctx["actor"]): Ctx {
  return { db: undefined as never, clock, ids, actor };
}

// Models the adapter contract: the publisher status change, the KYB row, and the outbox event commit together,
// and a status that no longer matches the expected one writes nothing.
class MemoryPublisherKybStore implements PublisherKybStore {
  publishers = new Map<string, Publisher>();
  writes: KybSubmissionWrite[] = [];

  async findPublisher(id: Id<"publisher">): Promise<Publisher | null> {
    return this.publishers.get(id) ?? null;
  }

  async recordSubmission(write: KybSubmissionWrite): Promise<boolean> {
    const current = this.publishers.get(write.publisher.id);
    if (current?.status !== write.expectedStatus) return false;
    this.publishers.set(write.publisher.id, write.publisher);
    this.writes.push(write);
    return true;
  }
}

function storeWithDraftPublisher(status: Publisher["status"] = "draft") {
  const store = new MemoryPublisherKybStore();
  store.publishers.set(publisherId, { ...draftPublisher({ id: publisherId, legalName: "Acme Media" }), status });
  return store;
}

const valid = { entity_type: "company", company_reference: "CRN-12345678", document_reference: "vault:kyb/doc_0001" };
const actor = ctxFor({ type: "user", id: actorId });

describe("submitKyb (TP-W3-003)", () => {
  test("stores the document reference and moves the publisher to in_review", async () => {
    const store = storeWithDraftPublisher();
    const result = await submitKyb(actor, store, publisherId, valid);

    expect(result).toEqual({ ok: true, value: { kybId, publisherId, status: "in_review" } });
    expect(store.publishers.get(publisherId)?.status).toBe("in_review");
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]?.kyb).toMatchObject({
      id: kybId,
      publisherId,
      entityType: "company",
      companyReference: "CRN-12345678",
      providerRef: "vault:kyb/doc_0001",
      state: "in_review",
      createdAt: clock.now(),
    });
  });

  test("writes a publisher.submitted event in the same write as the KYB row", async () => {
    const store = storeWithDraftPublisher();
    await submitKyb(actor, store, publisherId, valid);
    expect(store.writes[0]?.event).toEqual({
      id: `publisher.submitted:${kybId}`,
      topic: "publisher.submitted",
      aggregateId: publisherId,
      aggregateVersion: 1,
      payload: { publisherId, kybId, state: "in_review" },
    });
  });

  test("the outcome and the event never carry the document reference", async () => {
    const store = storeWithDraftPublisher();
    const result = await submitKyb(actor, store, publisherId, valid);
    expect(JSON.stringify(result)).not.toContain("vault:kyb");
    expect(JSON.stringify(store.writes[0]?.event)).not.toContain("vault:kyb");
  });

  test("a caller that is not a user is UNAUTHENTICATED and nothing is written", async () => {
    const store = storeWithDraftPublisher();
    const result = await submitKyb(ctxFor({ type: "system", id: null }), store, publisherId, valid);
    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(store.writes).toHaveLength(0);
  });

  test("invalid input is VALIDATION_FAILED and the store is not called", async () => {
    const store = storeWithDraftPublisher();
    const result = await submitKyb(actor, store, publisherId, { ...valid, document_reference: "%PDF-1.7 bytes" });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(store.writes).toHaveLength(0);
  });

  test("an unknown publisher is RESOURCE_NOT_FOUND", async () => {
    const store = new MemoryPublisherKybStore();
    const result = await submitKyb(actor, store, publisherId, valid);
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });

  test("a publisher that is not draft cannot submit KYB again (STATE_CONFLICT)", async () => {
    const store = storeWithDraftPublisher("submitted");
    const result = await submitKyb(actor, store, publisherId, valid);
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(store.writes).toHaveLength(0);
  });

  test("a submission that loses a race to another writer is STATE_CONFLICT", async () => {
    const store = storeWithDraftPublisher();
    store.recordSubmission = async () => false;
    const result = await submitKyb(actor, store, publisherId, valid);
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });
});
