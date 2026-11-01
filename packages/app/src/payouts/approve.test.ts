import { describe, expect, test } from "bun:test";
import type { Id, IdKind, Principal } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type {
  BatchApproveInput,
  BatchApproveOutcome,
  PayoutBatchRecord,
  PayoutBatchStore,
} from "../ports/payout-batch-store";
import type { PublisherBalanceSource } from "../ports/publisher-balance-source";
import { approveBatch } from "./approve";

// Ports are local stubs, as in batch.test.ts. The shared contract in test-kit runs this action against the fake store and the
// Postgres adapter; these cases cover what the action decides before and after the store.

const maker = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const checker = "usr_01arz3ndektsv4rrffq69g5faw" as Id<"user">;
const orgId = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const batchId = "pbt_01arz3ndektsv4rrffq69g5fav" as Id<"payoutBatch">;
const publisherId = "pub_01arz3ndektsv4rrffq69g5fav" as Id<"publisher">;
const scope = { organizationId: orgId };
const now = new Date("2026-11-02T00:00:00.000Z");

const as = (userId: Id<"user">, role: "finance" | "viewer" = "finance"): Principal => ({
  userId,
  memberships: [{ organizationId: orgId, role }],
});

let sequence = 0;
const ids = {
  next<K extends IdKind>(_kind: K): Id<K> {
    sequence += 1;
    return `aud_${String(sequence).padStart(26, "0")}` as Id<K>;
  },
};

function ctxFor(principal: Principal): Ctx {
  return { db: undefined as never, clock: { now: () => now }, ids, actor: { type: "user", id: principal.userId } };
}

const stored: PayoutBatchRecord = {
  id: batchId,
  organizationId: orgId,
  reservationKey: "run-2026-10-gbp",
  currency: "GBP",
  periodStart: new Date("2026-10-01T00:00:00.000Z"),
  periodEnd: new Date("2026-10-31T00:00:00.000Z"),
  state: "prepared",
  capMinor: null,
  policyVersion: 1,
  createdBy: maker,
  createdAt: now,
  approvedBy: null,
  approvedAt: null,
  lines: [
    {
      id: "pay_01arz3ndektsv4rrffq69g5fav" as Id<"payout">,
      publisherId,
      methodId: "pmt_01arz3ndektsv4rrffq69g5fav" as Id<"payoutMethod">,
      amountMinor: 5_000n,
      state: "reserved",
    },
  ],
};

function setup(options: { batch?: PayoutBatchRecord | null; outcome?: BatchApproveOutcome } = {}) {
  const approvals: BatchApproveInput[] = [];
  let balanceReads = 0;
  const batches: PayoutBatchStore = {
    async reserve() {
      return { outcome: "nothing_reserved", skipped: [] };
    },
    async cancel() {
      return "not_found";
    },
    async approve(input) {
      approvals.push(input);
      return options.outcome ?? { outcome: "approved", batch: { ...stored, state: "approved" } };
    },
    async find() {
      return options.batch === undefined ? stored : options.batch;
    },
    async listCandidates() {
      return [];
    },
  };
  const balances: PublisherBalanceSource = {
    async listConversions() {
      balanceReads += 1;
      return [];
    },
  };
  return { deps: { batches, balances }, approvals, reads: () => balanceReads };
}

describe("approveBatch", () => {
  test("a user without payouts:write is forbidden and nothing is read or written", async () => {
    const { deps, approvals, reads } = setup();
    const viewer = as(checker, "viewer");
    expect(await approveBatch(ctxFor(viewer), deps, viewer, scope, batchId)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(approvals).toHaveLength(0);
    expect(reads()).toBe(0);
  });

  test("the actor must be the principal", async () => {
    const { deps, approvals } = setup();
    const ctx = { ...ctxFor(as(checker)), actor: { type: "user" as const, id: maker } };
    expect(await approveBatch(ctx, deps, as(checker), scope, batchId)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(approvals).toHaveLength(0);
  });

  test.each([
    ["a malformed id", "nope"],
    ["an id of another kind", "pub_01arz3ndektsv4rrffq69g5fav"],
  ])("%s is not found", async (_name, id) => {
    const { deps, approvals } = setup();
    expect(await approveBatch(ctxFor(as(checker)), deps, as(checker), scope, id)).toEqual({
      ok: false,
      code: "RESOURCE_NOT_FOUND",
    });
    expect(approvals).toHaveLength(0);
  });

  test("a batch the organization does not have is not found", async () => {
    const { deps, approvals } = setup({ batch: null });
    expect(await approveBatch(ctxFor(as(checker)), deps, as(checker), scope, batchId)).toMatchObject({
      ok: false,
      code: "RESOURCE_NOT_FOUND",
    });
    expect(approvals).toHaveLength(0);
  });

  test("the approver and the time come from the principal and the clock, with the balance read for each publisher", async () => {
    const { deps, approvals, reads } = setup();
    const result = await approveBatch(ctxFor(as(checker)), deps, as(checker), scope, batchId);
    expect(result).toMatchObject({ ok: true, value: { batch: { state: "approved" } } });
    expect(reads()).toBe(1);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      organizationId: orgId,
      batchId,
      approver: checker,
      at: now,
      availability: [{ publisherId, availableMinor: 0n }],
      audit: { actor: { type: "user", id: checker }, occurredAt: now },
    });
  });

  test("the preparer is sent to the store without a balance read, so the refusal is audited there", async () => {
    const { deps, approvals, reads } = setup({ outcome: { outcome: "refused", reason: "self_approval" } });
    const result = await approveBatch(ctxFor(as(maker)), deps, as(maker), scope, batchId);
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(reads()).toBe(0);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.approver).toBe(maker);
  });

  test.each([
    ["cancelled", "STATE_CONFLICT"],
    ["already_approved", "ALREADY_PROCESSED"],
  ] as const)("a batch refused as %s is %s", async (reason, code) => {
    const { deps } = setup({ outcome: { outcome: "refused", reason } });
    expect(await approveBatch(ctxFor(as(checker)), deps, as(checker), scope, batchId)).toMatchObject({
      ok: false,
      code,
    });
  });

  test("a balance that no longer covers the batch is a state conflict that names the count, not the publishers", async () => {
    const { deps } = setup({ outcome: { outcome: "insufficient_funds", publisherIds: [publisherId] } });
    const result = await approveBatch(ctxFor(as(checker)), deps, as(checker), scope, batchId);
    expect(result).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
    expect(JSON.stringify(result)).not.toContain(publisherId);
  });
});
