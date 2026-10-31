import { describe, expect, test } from "bun:test";
import { fixtureId } from "../fixtures/ids";
import { FakePublisherReviewStore } from "./publisher-review-store";

const publisher = {
  id: fixtureId("publisher"),
  legalName: "Acme Media Ltd",
  status: "approved" as const,
};

const write = () => ({
  publisher,
  audit: {
    id: fixtureId("audit"),
    organizationId: fixtureId("organization"),
    actor: { type: "user", id: fixtureId("user") as string },
    action: "approve" as const,
    entityType: "publisher" as const,
    entityId: publisher.id,
    metadata: { reason: "DNS ok" },
    occurredAt: new Date(0),
  },
});

function seeded(): FakePublisherReviewStore {
  const store = new FakePublisherReviewStore();
  store.records = [{ publisher: { ...publisher, status: "in_review" }, organizationId: fixtureId("organization") }];
  return store;
}

describe("FakePublisherReviewStore", () => {
  test("commits the new status and the audit row together", async () => {
    const store = seeded();
    await store.recordDecision(write());
    expect(store.records[0]?.publisher.status).toBe("approved");
    expect(store.audits).toHaveLength(1);
  });

  test("a failed audit write leaves the publisher in review", async () => {
    const store = seeded();
    store.failAudit = true;
    await expect(store.recordDecision(write())).rejects.toThrow("audit write failed");
    expect(store.records[0]?.publisher.status).toBe("in_review");
    expect(store.audits).toHaveLength(0);
  });
});
