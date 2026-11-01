import { describe, expect, test } from "bun:test";
import { createPayoutPolicy, type Id, type IdKind, type PayoutPolicy, type Principal } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { BatchReserveWrite, PayoutBatchStore } from "../ports/payout-batch-store";
import type { PayoutHoldStore } from "../ports/payout-hold-store";
import type { PayoutPolicyStore } from "../ports/payout-policy-store";
import type { PublisherBalanceSource } from "../ports/publisher-balance-source";
import { cancelBatch, prepareBatch } from "./batch";

// The app package has no test-kit dependency, so the ports are local stubs. The shared contract in test-kit runs the same
// action against the fake store and the Postgres adapter; these cases cover what the action decides before and after the store.

const userId = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const orgId = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const scope = { organizationId: orgId };
const finance: Principal = { userId, memberships: [{ organizationId: orgId, role: "finance" }] };
const viewer: Principal = { userId, memberships: [{ organizationId: orgId, role: "viewer" }] };
const now = new Date("2026-11-01T00:00:00.000Z");

let sequence = 0;
const ids = {
  next<K extends IdKind>(kind: K): Id<K> {
    sequence += 1;
    const prefix = { payout: "pay", payoutBatch: "pbt", audit: "aud" }[kind as string] ?? "x";
    return `${prefix}_${String(sequence).padStart(26, "0")}` as Id<K>;
  },
};

function ctxFor(principal: Principal, clock = now): Ctx {
  return { db: undefined as never, clock: { now: () => clock }, ids, actor: { type: "user", id: principal.userId } };
}

const policy: PayoutPolicy = createPayoutPolicy({
  version: 3,
  currency: "GBP",
  minimumMinor: 1_000n,
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
});

function deps(overrides: { policies?: PayoutPolicy[]; reserve?: PayoutBatchStore["reserve"] } = {}) {
  const writes: BatchReserveWrite[] = [];
  const batches: PayoutBatchStore = {
    async reserve(write) {
      writes.push(write);
      return overrides.reserve ? overrides.reserve(write) : { outcome: "nothing_reserved", skipped: [] };
    },
    async cancel() {
      return "not_found";
    },
    async approve() {
      return { outcome: "not_found" };
    },
    async find() {
      return null;
    },
    async listCandidates() {
      return [];
    },
  };
  const balances: PublisherBalanceSource = {
    async listConversions() {
      return [];
    },
  };
  const policies: PayoutPolicyStore = {
    async publish() {
      return { outcome: "published" };
    },
    async list() {
      return overrides.policies ?? [policy];
    },
  };
  const holds: PayoutHoldStore = {
    async place() {},
    async release() {
      return false;
    },
    async listForPublisher() {
      return [];
    },
  };
  return { writes, deps: { batches, balances, policies, holds } };
}

const valid = {
  currency: "GBP",
  period_start: "2026-10-01T00:00:00.000Z",
  period_end: "2026-10-31T23:59:59.000Z",
  reservation_key: "run-2026-10-gbp",
};

describe("prepareBatch", () => {
  test("a user without payouts:write is forbidden and nothing is read or written", async () => {
    const { deps: d, writes } = deps();
    expect(await prepareBatch(ctxFor(viewer), d, viewer, scope, valid)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(writes).toHaveLength(0);
  });

  test("the actor must be the principal", async () => {
    const { deps: d } = deps();
    const ctx = { ...ctxFor(finance), actor: { type: "user", id: "usr_someone_else" } };
    expect(await prepareBatch(ctx, d, finance, scope, valid)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });

  test.each([
    ["a non-object body", "nope"],
    ["an unknown field", { ...valid, account_number: "12345678" }],
    ["an unknown currency", { ...valid, currency: "XXX1" }],
    ["a short reservation key", { ...valid, reservation_key: "short" }],
    ["a period that ends before it starts", { ...valid, period_end: "2026-09-01T00:00:00.000Z" }],
    ["a period without a UTC instant", { ...valid, period_start: "2026-10-01" }],
    ["a zero cap", { ...valid, cap_minor: "0" }],
    ["a numeric cap", { ...valid, cap_minor: 5000 }],
    ["a fractional cap", { ...valid, cap_minor: "10.5" }],
  ])("%s is refused as VALIDATION_FAILED before the store is used", async (_name, body) => {
    const { deps: d, writes } = deps();
    expect(await prepareBatch(ctxFor(finance), d, finance, scope, body)).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
    });
    expect(writes).toHaveLength(0);
  });

  test("a rejected value is never echoed in the reason", async () => {
    const { deps: d } = deps();
    const result = await prepareBatch(ctxFor(finance), d, finance, scope, { ...valid, reservation_key: "bad key!!" });
    expect(JSON.stringify(result)).not.toContain("bad key!!");
  });

  test("with no policy in effect there is nothing to decide against", async () => {
    const future = createPayoutPolicy({ ...policy, version: 1, effectiveFrom: new Date("2027-01-01T00:00:00.000Z") });
    const { deps: d, writes } = deps({ policies: [future] });
    expect(await prepareBatch(ctxFor(finance), d, finance, scope, valid)).toMatchObject({
      ok: false,
      code: "STATE_CONFLICT",
    });
    expect(writes).toHaveLength(0);
  });

  test("the batch records the policy version in effect and the cap as bigint", async () => {
    const { deps: d, writes } = deps();
    await prepareBatch(ctxFor(finance), d, finance, scope, { ...valid, cap_minor: "250000" });
    expect(writes[0]).toMatchObject({
      policyVersion: 3,
      capMinor: 250_000n,
      createdBy: userId,
      reservationKey: "run-2026-10-gbp",
    });
    expect(writes[0]?.audit.actor).toEqual({ type: "user", id: userId });
  });

  test("a reused key with different terms is STATE_CONFLICT", async () => {
    const { deps: d } = deps({ reserve: async () => ({ outcome: "key_conflict" }) });
    expect(await prepareBatch(ctxFor(finance), d, finance, scope, valid)).toMatchObject({
      ok: false,
      code: "STATE_CONFLICT",
    });
  });
});

describe("cancelBatch", () => {
  test("a user without payouts:write is forbidden", async () => {
    const { deps: d } = deps();
    expect(await cancelBatch(ctxFor(viewer), d, viewer, scope, "pbt_01arz3ndektsv4rrffq69g5fav")).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  test("a malformed id is not found without touching the store", async () => {
    const { deps: d } = deps();
    expect(await cancelBatch(ctxFor(finance), d, finance, scope, "not-an-id")).toEqual({
      ok: false,
      code: "RESOURCE_NOT_FOUND",
    });
  });
});
