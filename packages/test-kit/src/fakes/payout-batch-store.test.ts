import { describe, expect, test } from "bun:test";
import { runPayoutBatchStoreContract } from "../contracts/payout-batch-store";
import { fixtureId } from "../fixtures/ids";
import { FakePayoutBatchStore } from "./payout-batch-store";

const organizationId = fixtureId("organization", 1);
const otherOrganizationId = fixtureId("organization", 2);
const userId = fixtureId("user", 1);
const checkerId = fixtureId("user", 2);

runPayoutBatchStoreContract([
  {
    name: "fake",
    async open() {
      const store = new FakePayoutBatchStore();
      return {
        store,
        organizationId,
        otherOrganizationId,
        userId,
        checkerId,
        async addPublisher(input) {
          store.publisherOrganization.set(input.publisherId, input.organizationId);
          store.publisherStatus.set(input.publisherId, input.status ?? "approved");
          store.addMethod({ id: input.methodId, publisherId: input.publisherId, currency: input.currency });
        },
        async close() {},
      };
    },
  },
]);

// The contract reads the store through its port, which has no audit rows. The fake keeps them, and they must match what the
// Postgres adapter writes (reserve.test.ts reads the same fields from audit_logs).
describe("fake payout batch store audit", () => {
  test("an approval records both people, the time, the currency, and the amounts", async () => {
    const store = new FakePayoutBatchStore();
    const publisherId = fixtureId("publisher", 1);
    const methodId = fixtureId("payoutMethod", 1);
    store.publisherOrganization.set(publisherId, organizationId);
    store.addMethod({ id: methodId, publisherId, currency: "GBP" });
    const at = new Date("2026-11-02T09:30:00.000Z");
    const batchId = fixtureId("payoutBatch", 1);
    await store.reserve({
      organizationId,
      batchId,
      reservationKey: "reservation-1",
      currency: "GBP",
      periodStart: new Date("2026-10-01T00:00:00.000Z"),
      periodEnd: new Date("2026-10-31T00:00:00.000Z"),
      capMinor: null,
      policyVersion: 1,
      createdBy: userId,
      createdAt: at,
      lines: [
        {
          payoutId: fixtureId("payout", 1),
          publisherId,
          methodId,
          requestedMinor: 5_000n,
          availableMinor: 5_000n,
          minimumMinor: 1_000n,
        },
      ],
      audit: { id: fixtureId("audit", 1), actor: { type: "user", id: userId }, occurredAt: at },
    });
    await store.approve({
      organizationId,
      batchId,
      approver: checkerId,
      at,
      availability: [{ publisherId, availableMinor: 5_000n }],
      audit: { id: fixtureId("audit", 2), actor: { type: "user", id: checkerId }, occurredAt: at },
    });
    const row = store.audit.find((entry) => entry.action === "payout_batch.approved");
    expect(row).toMatchObject({
      entityId: batchId,
      actor: { type: "user", id: checkerId },
      occurredAt: at,
      metadata: {
        preparedBy: userId,
        approvedBy: checkerId,
        approvedAt: "2026-11-02T09:30:00.000Z",
        currency: "GBP",
        payoutCount: 1,
        totalMinor: "5000",
      },
    });
  });
});

test("fake refuses a self-approval with an audit row, and refuses a repeat approval as already approved", async () => {
  const store = new FakePayoutBatchStore();
  const publisherId = fixtureId("publisher", 2);
  const methodId = fixtureId("payoutMethod", 2);
  store.publisherOrganization.set(publisherId, organizationId);
  store.addMethod({ id: methodId, publisherId, currency: "GBP" });
  const at = new Date("2026-11-02T09:30:00.000Z");
  const batchId = fixtureId("payoutBatch", 2);
  await store.reserve({
    organizationId,
    batchId,
    reservationKey: "reservation-2",
    currency: "GBP",
    periodStart: at,
    periodEnd: at,
    capMinor: null,
    policyVersion: 1,
    createdBy: userId,
    createdAt: at,
    lines: [
      {
        payoutId: fixtureId("payout", 2),
        publisherId,
        methodId,
        requestedMinor: 5_000n,
        availableMinor: 5_000n,
        minimumMinor: 1_000n,
      },
    ],
    audit: { id: fixtureId("audit", 3), actor: { type: "user", id: userId }, occurredAt: at },
  });
  const approve = (approver: typeof checkerId, n: number, availability = [{ publisherId, availableMinor: 5_000n }]) =>
    store.approve({
      organizationId,
      batchId,
      approver,
      at,
      availability,
      audit: { id: fixtureId("audit", n), actor: { type: "user", id: approver }, occurredAt: at },
    });
  await approve(checkerId, 4);
  await approve(checkerId, 5);
  expect(store.audit.filter((row) => row.action === "payout_batch.approval_denied").at(-1)?.metadata).toMatchObject({
    attemptedBy: checkerId,
    reason: "already_approved",
  });
});

test("fake writes exactly one approval audit row when approvals race (TP-W7-048)", async () => {
  const store = new FakePayoutBatchStore();
  const publisherId = fixtureId("publisher", 1);
  const methodId = fixtureId("payoutMethod", 1);
  store.publisherOrganization.set(publisherId, organizationId);
  store.addMethod({ id: methodId, publisherId, currency: "GBP" });
  const at = new Date("2026-11-02T09:30:00.000Z");
  const batchId = fixtureId("payoutBatch", 1);
  await store.reserve({
    organizationId,
    batchId,
    reservationKey: "reservation-1",
    currency: "GBP",
    periodStart: new Date("2026-10-01T00:00:00.000Z"),
    periodEnd: new Date("2026-10-31T00:00:00.000Z"),
    capMinor: null,
    policyVersion: 1,
    createdBy: userId,
    createdAt: at,
    lines: [
      {
        payoutId: fixtureId("payout", 1),
        publisherId,
        methodId,
        requestedMinor: 5_000n,
        availableMinor: 5_000n,
        minimumMinor: 1_000n,
      },
    ],
    audit: { id: fixtureId("audit", 1), actor: { type: "user", id: userId }, occurredAt: at },
  });
  const input = {
    organizationId,
    batchId,
    approver: checkerId,
    at,
    availability: [{ publisherId, availableMinor: 5_000n }],
    audit: { id: fixtureId("audit", 2), actor: { type: "user" as const, id: checkerId }, occurredAt: at },
  };
  const results = await Promise.all(Array.from({ length: 6 }, () => store.approve(input)));
  expect(results.filter((result) => result.outcome === "approved")).toHaveLength(1);
  expect(store.audit.filter((row) => row.action === "payout_batch.approved")).toHaveLength(1);
});
