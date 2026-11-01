import { describe, expect, test } from "bun:test";
import { approveBatch } from "@moneytrap/app/src/payouts/approve";
import { cancelBatch, type PayoutBatchView, prepareBatch } from "@moneytrap/app/src/payouts/batch";
import type { PayoutBatchStore } from "@moneytrap/app/src/ports/payout-batch-store";
import { type CurrencyCode, createPayoutPolicy, createShareRule, type Id, type Principal } from "@moneytrap/domain";
import { FakeClock } from "../clock";
import { FakeIdGenerator } from "../fakes/id-generator";
import { FakePayoutHoldStore } from "../fakes/payout-hold-store";
import { FakePayoutPolicyStore } from "../fakes/payout-policy-store";
import { FakePublisherBalanceSource } from "../fakes/publisher-balance-source";
import { fixtureCtx } from "../fixtures/ctx";
import { fixtureId } from "../fixtures/ids";

// What a store under test must provide: a store, and a way to seed an approved publisher with an active payout method in a
// currency. The fake and the Postgres adapter each supply their own, so one suite runs against both (CT-022).
export interface PayoutBatchWorld {
  store: PayoutBatchStore;
  organizationId: Id<"organization">;
  otherOrganizationId: Id<"organization">;
  // The preparer, and a second user who may check. Both exist wherever the store keeps users, so approval can name them.
  userId: Id<"user">;
  checkerId: Id<"user">;
  addPublisher(input: {
    organizationId: Id<"organization">;
    publisherId: Id<"publisher">;
    methodId: Id<"payoutMethod">;
    currency: CurrencyCode;
    // Defaults to approved. Only approved publishers are batched.
    status?: "approved" | "suspended";
  }): Promise<void>;
  close(): Promise<void>;
}

export interface PayoutBatchContractTarget {
  name: string;
  open(): Promise<PayoutBatchWorld>;
}

const now = new Date("2026-11-01T00:00:00.000Z");
const periodStart = "2026-10-01T00:00:00.000Z";
const periodEnd = "2026-10-31T23:59:59.000Z";
const MINIMUM = 1_000n;

function pub(n: number): Id<"publisher"> {
  return fixtureId("publisher", n);
}

// A publisher whose whole recognized amount is theirs, cleared before `now`, so available equals `amountMinor`.
const fullShare = createShareRule(10000, 0, 0, 1);

interface Harness {
  world: PayoutBatchWorld;
  principal: Principal;
  checker: Principal;
  prepare(body?: Record<string, unknown>): ReturnType<typeof prepareBatch>;
  cancel(id: string, principal?: Principal, organizationId?: Id<"organization">): ReturnType<typeof cancelBatch>;
  approve(id: string, principal?: Principal, organizationId?: Id<"organization">): ReturnType<typeof approveBatch>;
  fund(n: number, amountMinor: bigint, status?: "approved" | "suspended"): Promise<void>;
  // A reversal that takes a publisher's whole balance back after funds were reserved.
  reverse(n: number): void;
  holds: FakePayoutHoldStore;
  nextKey(): string;
  available: Map<number, bigint>;
  reservedFor(batches: PayoutBatchView[], n: number): bigint;
}

async function harness(world: PayoutBatchWorld): Promise<Harness> {
  const clock = new FakeClock(now);
  const ids = new FakeIdGenerator();
  const balances = new FakePublisherBalanceSource();
  const policies = new FakePayoutPolicyStore(() => clock.now());
  policies.policies.push(
    createPayoutPolicy({
      version: 1,
      currency: "GBP",
      minimumMinor: MINIMUM,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    }),
  );
  const holds = new FakePayoutHoldStore(() => clock.now());
  const principal: Principal = {
    userId: world.userId,
    memberships: [{ organizationId: world.organizationId, role: "finance" }],
  };
  const checker: Principal = {
    userId: world.checkerId,
    memberships: [{ organizationId: world.organizationId, role: "finance" }],
  };
  const ctx = (as: Principal = principal) =>
    fixtureCtx<Record<string, never>>(undefined as never, {
      clock,
      ids,
      actor: { type: "user", id: as.userId },
    });
  const deps = { batches: world.store, balances, policies, holds };
  let keys = 0;
  const available = new Map<number, bigint>();
  const h: Harness = {
    world,
    principal,
    checker,
    holds,
    available,
    nextKey() {
      keys += 1;
      return `key-${String(keys).padStart(6, "0")}`;
    },
    prepare(body = {}) {
      return prepareBatch(
        ctx(),
        deps,
        principal,
        { organizationId: world.organizationId },
        {
          currency: "GBP",
          period_start: periodStart,
          period_end: periodEnd,
          reservation_key: h.nextKey(),
          ...body,
        },
      );
    },
    cancel(id, as = principal, organizationId = world.organizationId) {
      return cancelBatch(ctx(as), deps, as, { organizationId }, id);
    },
    approve(id, as = checker, organizationId = world.organizationId) {
      return approveBatch(ctx(as), deps, as, { organizationId }, id);
    },
    reverse(n) {
      balances.clear(pub(n));
      available.set(n, 0n);
    },
    async fund(n, amountMinor, status = "approved") {
      await world.addPublisher({
        organizationId: world.organizationId,
        publisherId: pub(n),
        methodId: fixtureId("payoutMethod", n),
        currency: "GBP",
        status,
      });
      balances.add(pub(n), {
        conversionId: fixtureId("conversion", n),
        currency: "GBP",
        state: "approved",
        recognizedMinor: amountMinor,
        shareRule: fullShare,
        clearedAt: new Date("2026-10-15T00:00:00.000Z"),
      });
      available.set(n, amountMinor);
    },
    reservedFor(batches, n) {
      return batches
        .flatMap((batch) => batch.lines)
        .filter((line) => line.publisherId === pub(n) && line.state !== "cancelled")
        .reduce((sum, line) => sum + line.amountMinor, 0n);
    },
  };
  return h;
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok)
    throw new Error(
      `expected ok, got ${JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
    );
  return result as Extract<T, { ok: true }>;
}

/** Runs the batch preparation, reservation, and approval suite against each store and the maker-checker approval (DM-047, DM-048, CT-022, TP-W7-009 to TP-W7-018). */
export function runPayoutBatchStoreContract(targets: PayoutBatchContractTarget[]): void {
  for (const target of targets) {
    describe(`payout batch store: ${target.name}`, () => {
      async function withWorld(run: (h: Harness) => Promise<void>): Promise<void> {
        const world = await target.open();
        try {
          await run(await harness(world));
        } finally {
          await world.close();
        }
      }

      test("reserves each eligible publisher's available balance once", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          await h.fund(2, 25_000n);
          const { batch, replayed } = ok(await h.prepare()).value;
          expect(replayed).toBe(false);
          expect(batch.state).toBe("prepared");
          expect(batch.lines.map((line) => [line.publisherId, line.amountMinor])).toEqual([
            [pub(1), 10_000n],
            [pub(2), 25_000n],
          ]);
          expect(batch.totalMinor).toBe(35_000n);
          expect(batch.policyVersion).toBe(1);
        }));

      test("a re-run with the same reservation key returns the batch and reserves nothing more (TP-W7-013)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const body = { reservation_key: "run-2026-10-gbp" };
          const first = ok(await h.prepare(body)).value;
          const second = ok(await h.prepare(body)).value;
          expect(second.replayed).toBe(true);
          expect(second.batch.id).toBe(first.batch.id);
          expect(second.batch.lines).toEqual(first.batch.lines);

          // A different key over the same funds finds nothing left to reserve.
          const third = await h.prepare();
          expect(third).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
          const stored = await h.world.store.find(h.world.organizationId, first.batch.id);
          expect(stored?.lines.filter((line) => line.state === "reserved")).toHaveLength(1);
          expect(stored?.lines[0]?.amountMinor).toBe(10_000n);
        }));

      test("the same key with different terms is a conflict, not a second batch", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          ok(await h.prepare({ reservation_key: "run-2026-10-gbp" }));
          const changed = await h.prepare({ reservation_key: "run-2026-10-gbp", cap_minor: "5000" });
          expect(changed).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
          const otherPeriod = await h.prepare({
            reservation_key: "run-2026-10-gbp",
            period_end: "2026-11-01T00:00:00.000Z",
          });
          expect(otherPeriod).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
        }));

      test("a second batch over the same funds reserves only what is left (TP-W7-012)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const first = ok(await h.prepare({ cap_minor: "6000" })).value.batch;
          const second = ok(await h.prepare()).value.batch;
          expect(first.totalMinor).toBe(6_000n);
          expect(second.totalMinor).toBe(4_000n);
          expect(h.reservedFor([first, second], 1)).toBe(10_000n);
        }));

      test("a remainder under the policy minimum is not reserved", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          ok(await h.prepare({ cap_minor: "9500" }));
          // 500 is left, under the 1000 minimum.
          expect(await h.prepare()).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
        }));

      test("concurrent preparations over the same funds never reserve more than available (CT-022)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          await h.fund(2, 7_000n);
          const results = await Promise.all(Array.from({ length: 6 }, () => h.prepare()));
          const batches = results.filter((r) => r.ok).map((r) => ok(r).value.batch);
          // Exactly one run takes the funds; the others fail for lack of any.
          expect(batches).toHaveLength(1);
          for (const result of results) if (!result.ok) expect(result.code).toBe("STATE_CONFLICT");
          expect(h.reservedFor(batches, 1)).toBe(10_000n);
          expect(h.reservedFor(batches, 2)).toBe(7_000n);
        }));

      test("concurrent capped preparations split the funds without exceeding them (CT-022)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const results = await Promise.all(Array.from({ length: 5 }, () => h.prepare({ cap_minor: "3000" })));
          const batches = results.filter((r) => r.ok).map((r) => ok(r).value.batch);
          const total = batches.reduce((sum, batch) => sum + batch.totalMinor, 0n);
          expect(total).toBeLessThanOrEqual(10_000n);
          expect(h.reservedFor(batches, 1)).toBe(total);
          // 3 x 3000 fit, then 1000 is left, which meets the minimum, so a fourth reserves it.
          expect(total).toBe(10_000n);
        }));

      test("concurrent runs with the same key make one batch", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const body = { reservation_key: "run-2026-10-gbp" };
          const results = await Promise.all(Array.from({ length: 5 }, () => h.prepare(body)));
          const values = results.map((r) => ok(r).value);
          expect(new Set(values.map((value) => value.batch.id)).size).toBe(1);
          expect(values.filter((value) => !value.replayed)).toHaveLength(1);
          expect(values[0]?.batch.totalMinor).toBe(10_000n);
        }));

      test("a publisher below the minimum or under a hold is left out with its reason (TP-W7-009, TP-W7-010)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          await h.fund(2, 500n);
          await h.fund(3, 10_000n);
          h.holds.publisherOrganization.set(pub(3), h.world.organizationId);
          await h.holds.place({
            hold: {
              id: fixtureId("payoutHold", 1),
              publisherId: pub(3),
              currency: "GBP",
              amountMinor: 1n,
              reason: "KYB review",
              expiresAt: null,
            },
            organizationId: h.world.organizationId,
            auditId: fixtureId("audit", 900),
            actor: { type: "user", id: h.world.userId },
            occurredAt: now,
          });
          const { batch, excluded } = ok(await h.prepare()).value;
          expect(batch.lines.map((line) => line.publisherId)).toEqual([pub(1)]);
          expect(excluded).toEqual(
            expect.arrayContaining([
              { publisherId: pub(2), reasons: ["below_minimum"] },
              { publisherId: pub(3), reasons: ["held"] },
            ]),
          );
        }));

      test("the limited release cap bounds the batch total (WP-7.7 cap)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          await h.fund(2, 10_000n);
          await h.fund(3, 10_000n);
          const { batch, excluded } = ok(await h.prepare({ cap_minor: "12000" })).value;
          expect(batch.capMinor).toBe(12_000n);
          expect(batch.totalMinor).toBe(12_000n);
          expect(batch.lines.map((line) => line.amountMinor)).toEqual([10_000n, 2_000n]);
          expect(excluded).toEqual([{ publisherId: pub(3), reasons: ["over_cap"] }]);
        }));

      test("nothing to reserve writes no batch and leaves the key free", () =>
        withWorld(async (h) => {
          const empty = await h.prepare({ reservation_key: "run-2026-10-gbp" });
          expect(empty).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
          await h.fund(1, 10_000n);
          const retry = ok(await h.prepare({ reservation_key: "run-2026-10-gbp" })).value;
          expect(retry.replayed).toBe(false);
          expect(retry.batch.totalMinor).toBe(10_000n);
        }));

      test("a publisher that is not approved is not batched, even with a balance", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          await h.fund(5, 10_000n, "suspended");
          const { batch } = ok(await h.prepare()).value;
          expect(batch.lines.map((line) => line.publisherId)).toEqual([pub(1)]);
        }));

      test("only publishers of the caller's organization are batched", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          await h.world.addPublisher({
            organizationId: h.world.otherOrganizationId,
            publisherId: pub(9),
            methodId: fixtureId("payoutMethod", 9),
            currency: "GBP",
          });
          const { batch } = ok(await h.prepare()).value;
          expect(batch.lines.map((line) => line.publisherId)).toEqual([pub(1)]);
        }));

      test("cancelling frees the funds for a later batch, and cancelling again changes nothing", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const first = ok(await h.prepare()).value.batch;
          expect(await h.prepare()).toMatchObject({ ok: false });

          expect(ok(await h.cancel(first.id)).value).toEqual({ id: first.id, state: "cancelled" });
          expect(ok(await h.cancel(first.id)).value.state).toBe("cancelled");
          const stored = await h.world.store.find(h.world.organizationId, first.id);
          expect(stored?.state).toBe("cancelled");
          expect(stored?.lines.every((line) => line.state === "cancelled")).toBe(true);

          const second = ok(await h.prepare()).value.batch;
          expect(second.totalMinor).toBe(10_000n);
        }));

      test("re-running the key of a cancelled batch is refused, not replayed as a success", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const body = { reservation_key: "run-2026-10-gbp" };
          const first = ok(await h.prepare(body)).value.batch;
          ok(await h.cancel(first.id));
          expect(await h.prepare(body)).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
          // A new key reserves the freed funds.
          expect(ok(await h.prepare()).value.batch.totalMinor).toBe(10_000n);
        }));

      test("a batch of another organization or an unknown batch is not found on cancel", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const batch = ok(await h.prepare()).value.batch;
          const outsider: Principal = {
            userId: h.world.userId,
            memberships: [{ organizationId: h.world.otherOrganizationId, role: "finance" }],
          };
          expect(await h.cancel(batch.id, outsider, h.world.otherOrganizationId)).toMatchObject({
            ok: false,
            code: "RESOURCE_NOT_FOUND",
          });
          expect(await h.world.store.find(h.world.otherOrganizationId, batch.id)).toBeNull();
          expect(await h.cancel(fixtureId("payoutBatch", 777))).toMatchObject({
            ok: false,
            code: "RESOURCE_NOT_FOUND",
          });
          // The batch is untouched by the outsider's attempt.
          expect((await h.world.store.find(h.world.organizationId, batch.id))?.state).toBe("prepared");
        }));

      test("a second user approves a prepared batch, once, and its funds stay held (TP-W7-017)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          await h.fund(2, 25_000n);
          const prepared = ok(await h.prepare()).value.batch;
          const { batch } = ok(await h.approve(prepared.id)).value;
          expect(batch.state).toBe("approved");
          expect(batch.createdBy).toBe(h.world.userId);
          expect(batch.approvedBy).toBe(h.world.checkerId);
          expect(batch.approvedAt).toEqual(now);
          expect(batch.totalMinor).toBe(35_000n);
          expect(batch.lines.map((line) => line.state)).toEqual(["approved", "approved"]);

          const stored = await h.world.store.find(h.world.organizationId, prepared.id);
          expect(stored?.state).toBe("approved");
          expect(stored?.approvedBy).toBe(h.world.checkerId);
          expect(stored?.lines.every((line) => line.state === "approved")).toBe(true);
          // Approved payouts still hold their funds, so nothing is left for another batch.
          expect(await h.prepare()).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
        }));

      test("the preparer cannot approve their own batch (TP-W7-016, TP-W7-049)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const prepared = ok(await h.prepare()).value.batch;
          expect(await h.approve(prepared.id, h.principal)).toMatchObject({ ok: false, code: "FORBIDDEN" });
          const stored = await h.world.store.find(h.world.organizationId, prepared.id);
          expect(stored?.state).toBe("prepared");
          expect(stored?.approvedBy).toBeNull();
          expect(stored?.approvedAt).toBeNull();
          // Refused for the preparer, approved for the checker.
          expect(ok(await h.approve(prepared.id)).value.batch.state).toBe("approved");
        }));

      test("approval is recorded once: a second approval is refused and changes nothing (TP-W7-048)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const prepared = ok(await h.prepare()).value.batch;
          ok(await h.approve(prepared.id));
          expect(await h.approve(prepared.id)).toMatchObject({ ok: false, code: "ALREADY_PROCESSED" });
          expect(await h.approve(prepared.id, h.principal)).toMatchObject({ ok: false, code: "FORBIDDEN" });
          const stored = await h.world.store.find(h.world.organizationId, prepared.id);
          expect(stored?.state).toBe("approved");
          expect(stored?.approvedBy).toBe(h.world.checkerId);
        }));

      test("a cancelled batch cannot be approved, and an approved batch cannot be cancelled (TP-W7-018, TP-W7-050)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const cancelled = ok(await h.prepare()).value.batch;
          ok(await h.cancel(cancelled.id));
          expect(await h.approve(cancelled.id)).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
          expect((await h.world.store.find(h.world.organizationId, cancelled.id))?.state).toBe("cancelled");

          const approved = ok(await h.prepare()).value.batch;
          ok(await h.approve(approved.id));
          expect(await h.cancel(approved.id)).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
          const stored = await h.world.store.find(h.world.organizationId, approved.id);
          expect(stored?.state).toBe("approved");
          expect(stored?.lines.every((line) => line.state === "approved")).toBe(true);
        }));

      test("a user without payouts:write cannot approve, and another organization's batch is not found", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const batch = ok(await h.prepare()).value.batch;
          const viewer: Principal = {
            userId: h.world.checkerId,
            memberships: [{ organizationId: h.world.organizationId, role: "viewer" }],
          };
          expect(await h.approve(batch.id, viewer)).toMatchObject({ ok: false, code: "FORBIDDEN" });

          const outsider: Principal = {
            userId: h.world.checkerId,
            memberships: [{ organizationId: h.world.otherOrganizationId, role: "finance" }],
          };
          expect(await h.approve(batch.id, outsider, h.world.otherOrganizationId)).toMatchObject({
            ok: false,
            code: "RESOURCE_NOT_FOUND",
          });
          expect(await h.approve(fixtureId("payoutBatch", 777))).toMatchObject({
            ok: false,
            code: "RESOURCE_NOT_FOUND",
          });
          expect(await h.approve("not-an-id")).toMatchObject({ ok: false, code: "RESOURCE_NOT_FOUND" });
          expect((await h.world.store.find(h.world.organizationId, batch.id))?.state).toBe("prepared");
        }));

      test("a balance reversed before approval stops the approval, and the batch can still be cancelled (TP-W7-014, sequential case only; the read-to-lock window is OZE-3285)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          await h.fund(2, 7_000n);
          const batch = ok(await h.prepare()).value.batch;
          h.reverse(1);
          expect(await h.approve(batch.id)).toMatchObject({ ok: false, code: "STATE_CONFLICT" });
          const stored = await h.world.store.find(h.world.organizationId, batch.id);
          expect(stored?.state).toBe("prepared");
          expect(stored?.lines.every((line) => line.state === "reserved")).toBe(true);
          expect(ok(await h.cancel(batch.id)).value.state).toBe("cancelled");
        }));

      test("concurrent approvals make one approval (TP-W7-048)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const batch = ok(await h.prepare()).value.batch;
          const results = await Promise.all(Array.from({ length: 6 }, () => h.approve(batch.id)));
          expect(results.filter((result) => result.ok)).toHaveLength(1);
          for (const result of results) if (!result.ok) expect(result.code).toBe("ALREADY_PROCESSED");
          expect((await h.world.store.find(h.world.organizationId, batch.id))?.state).toBe("approved");
        }));

      test("a reservation after an approval never holds more than the publisher has (approve's own lock is OZE-3285)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const first = ok(await h.prepare({ cap_minor: "4000" })).value.batch;
          const [approved, second] = await Promise.all([h.approve(first.id), h.prepare()]);
          expect(approved.ok).toBe(true);
          const batches = [first, ...(second.ok ? [second.value.batch] : [])];
          const current = (
            await Promise.all(batches.map((batch) => h.world.store.find(h.world.organizationId, batch.id)))
          ).filter((batch) => batch !== null);
          const held = current
            .flatMap((batch) => batch.lines)
            .filter((line) => line.state !== "cancelled")
            .reduce((sum, line) => sum + line.amountMinor, 0n);
          // The approved 4000 and the second batch's 6000 together are exactly the available funds, never more.
          expect(held).toBe(10_000n);
          expect(current.find((batch) => batch.id === first.id)?.state).toBe("approved");
        }));

      test("approving and cancelling at once leave exactly one of them in effect (TP-W7-050)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          const batch = ok(await h.prepare()).value.batch;
          const [approved, cancelled] = await Promise.all([h.approve(batch.id), h.cancel(batch.id)]);
          expect(approved.ok !== cancelled.ok).toBe(true);
          const stored = await h.world.store.find(h.world.organizationId, batch.id);
          expect(stored?.state).toBe(approved.ok ? "approved" : "cancelled");
          expect(stored?.lines.every((line) => line.state === stored.state)).toBe(true);
        }));

      // TP-W7-015: whatever order batches are prepared, cancelled, and approved in, reservations never exceed available.
      test("property: random prepare, cancel, and approve interleavings never reserve more than available (TP-W7-015)", () =>
        withWorld(async (h) => {
          await h.fund(1, 10_000n);
          await h.fund(2, 6_000n);
          await h.fund(3, 3_000n);
          let seed = 7;
          const roll = (max: number) => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed % max;
          };
          const batches: PayoutBatchView[] = [];
          for (let step = 0; step < 40; step += 1) {
            const action = roll(4);
            if (batches.length > 0 && action === 0) {
              // Cancelling an approved batch is refused, so a refusal here is expected and changes nothing.
              const target = batches[roll(batches.length)];
              if (target) await h.cancel(target.id);
            } else if (batches.length > 0 && action === 1) {
              const target = batches[roll(batches.length)];
              if (target) await h.approve(target.id);
            } else {
              const caps = [undefined, "2500", "4000", "9000"] as const;
              const cap = caps[roll(caps.length)];
              const result = await h.prepare(cap === undefined ? {} : { cap_minor: cap });
              if (result.ok) batches.push(result.value.batch);
            }
            // Re-read every batch so cancelled lines stop counting; approved lines still hold their funds.
            const current = (
              await Promise.all(batches.map((batch) => h.world.store.find(h.world.organizationId, batch.id)))
            ).filter((batch) => batch !== null);
            for (const n of [1, 2, 3]) {
              const reserved = current
                .flatMap((batch) => batch.lines)
                .filter((line) => line.publisherId === pub(n) && line.state !== "cancelled")
                .reduce((sum, line) => sum + line.amountMinor, 0n);
              expect(reserved <= (h.available.get(n) ?? 0n)).toBe(true);
            }
          }
        }));
    });
  }
}
