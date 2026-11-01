import { describe, expect, test } from "bun:test";
import { type ImportBatchInput, importConversionBatch } from "@moneytrap/app/src/conversions/import-batch";
import { matchConversion } from "@moneytrap/app/src/conversions/match";
import { recordConversionAdjustment } from "@moneytrap/app/src/conversions/status";
import { publisherBalances } from "@moneytrap/app/src/finance/balances";
import { allocate, createShareRule, type Id, Money } from "@moneytrap/domain";
import { Journal } from "@moneytrap/domain/src/ledger/journal";
import { Posting } from "@moneytrap/domain/src/ledger/posting";
import {
  FakeClock,
  FakeConversionImportStore,
  FakeConversionStatusStore,
  FakeIdGenerator,
  FakePublisherBalanceSource,
  fixtureCtx,
  fixtureId,
} from "@moneytrap/test-kit";
import { FakeAttributionClickStore } from "@moneytrap/test-kit/src/fakes/attribution-click-store";

// Milestone M5 (wave 6): conversions and ledger. Each case drives the app layer with the test-kit fakes, the same actions
// the routes call. Amounts stay bigint minor units; the import rows carry decimal strings that parse to them.

const sourceAt = new Date("2026-10-01T10:00:00Z");
const occurredAt = "2026-10-01T09:00:00.000Z";
// Batch digests are lower-case hex SHA-256 values, so each batch gets a distinct 64-character one.
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const digestC = "c".repeat(64);

// The recognition journal: one debit for the recognized amount, one credit per share. A zero share has nothing to post,
// and Posting refuses a zero amount, so that leg is left out.
function recognitionJournal(recognized: Money, shares: { account: string; money: Money }[]) {
  const credits = shares.filter((share) => share.money.amount > 0n);
  return Journal.create([
    Posting.debit("acct_recognized_receivable", recognized),
    ...credits.map((share) => Posting.credit(share.account, share.money)),
  ]);
}

function ctxWith() {
  return fixtureCtx<Record<string, never>>(undefined as never, {
    clock: new FakeClock(),
    ids: new FakeIdGenerator(),
  });
}

function batch(sha256Digest: string, rows: unknown[]): ImportBatchInput {
  return {
    networkId: "net_one",
    resource: "transactions",
    sha256Digest,
    objectRef: `objects/${sha256Digest.slice(0, 4)}.json`,
    parserVersion: "v1",
    sourceFrom: null,
    sourceTo: null,
    rows,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    externalRowRef: "txn-1",
    sourceRevision: "r1",
    currency: "USD",
    amount: "100.00",
    status: "approved",
    occurredAt,
    subId: "sub-a",
    ...overrides,
  };
}

describe("[M5] finance conformance (part 1)", () => {
  test("[M5] CT-012 network report batch replayed: import repeated", async () => {
    const store = new FakeConversionImportStore();
    const ctx = ctxWith();
    const report = batch(digestA, [row({ externalRowRef: "txn-1" }), row({ externalRowRef: "txn-2" })]);

    const first = await importConversionBatch(ctx, store, report);
    expect(first).toMatchObject({ ok: true, value: { outcome: "imported", counts: { created: 2 } } });
    const rowsAfterFirst = store.rows.length;
    const revisionsAfterFirst = store.revisions.length;

    const replay = await importConversionBatch(ctx, store, report);

    expect(replay).toMatchObject({ ok: true, value: { outcome: "replayed", counts: { created: 0, revised: 0 } } });
    expect(store.rows).toHaveLength(rowsAfterFirst);
    expect(store.revisions).toHaveLength(revisionsAfterFirst);
  });

  test("[M5] CT-016 one approved conversion: finance posts recognition", () => {
    // 70/30 share on 100.00 USD. The recognition journal debits recognized revenue and credits each share; the
    // publisher share is the same allocation the balance view reads (CT-016, TP-W6-029).
    const rule = createShareRule(7000, 3000, 0, 1);
    const recognized = Money.of(10_000n, "USD");
    const allocation = allocate(recognized, rule);

    expect(allocation.publisher.amount + allocation.platform.amount + allocation.other.amount).toBe(10_000n);

    const journal = recognitionJournal(recognized, [
      { account: "acct_publisher_payable", money: allocation.publisher },
      { account: "acct_platform_revenue", money: allocation.platform },
      { account: "acct_other_revenue", money: allocation.other },
    ]);
    expect(journal.ok).toBe(true);
    if (!journal.ok) return;
    expect(journal.value.netByCurrency("USD")).toBe(0n);
  });

  test("[M5] CT-016 an odd amount under a three-way rule still allocates the exact total", () => {
    // 0.01 USD split 33/33/34 cannot divide evenly. Largest-remainder allocation must still sum to the recognized amount.
    const rule = createShareRule(3300, 3300, 3400, 1);
    const recognized = Money.of(1n, "USD");
    const allocation = allocate(recognized, rule);

    expect(allocation.publisher.amount + allocation.platform.amount + allocation.other.amount).toBe(1n);
    const journal = recognitionJournal(recognized, [
      { account: "acct_publisher_payable", money: allocation.publisher },
      { account: "acct_platform_revenue", money: allocation.platform },
      { account: "acct_other_revenue", money: allocation.other },
    ]);
    expect(journal.ok).toBe(true);
  });

  test("[M5] CT-017 approved conversion not yet remitted: publisher views balance", async () => {
    const publisherId = fixtureId("publisher", 1) as Id<"publisher">;
    const source = new FakePublisherBalanceSource();
    source.add(publisherId, {
      conversionId: fixtureId("conversion", 1) as Id<"conversion">,
      currency: "USD",
      state: "approved",
      recognizedMinor: 10_000n,
      shareRule: createShareRule(7000, 3000, 0, 1),
      clearedAt: null,
    });

    const view = await publisherBalances(ctxWith(), source, { publisherId });

    expect(view.balances).toEqual([{ currency: "USD", estimatedMinor: 0n, approvedMinor: 7_000n, availableMinor: 0n }]);
  });

  test("[M5] CT-018 one conversion revised downward: latest source revision imported", async () => {
    const store = new FakeConversionImportStore();
    const ctx = ctxWith();
    await importConversionBatch(ctx, store, batch(digestA, [row({ amount: "100.00", sourceRevision: "r1" })]));

    const revised = await importConversionBatch(
      ctx,
      store,
      batch(digestB, [row({ amount: "80.00", sourceRevision: "r2" })]),
    );

    expect(revised).toMatchObject({ ok: true, value: { outcome: "imported", counts: { revised: 1, created: 0 } } });
    expect(store.revisions.map((r) => [r.revisionSeq, r.sourceRevision, r.payload.amountMinor])).toEqual([
      [1, "r1", "10000"],
      [2, "r2", "8000"],
    ]);

    // Replaying the revised file writes nothing: the latest revision is already the stored one.
    const replay = await importConversionBatch(
      ctx,
      store,
      batch(digestB, [row({ amount: "80.00", sourceRevision: "r2" })]),
    );
    expect(replay).toMatchObject({ ok: true, value: { outcome: "replayed" } });
    expect(store.revisions).toHaveLength(2);
  });

  test("[M5] CT-018 the downward change is booked as an adjustment, once, with history intact", async () => {
    const statusStore = new FakeConversionStatusStore();
    const conversionId = fixtureId("conversion", 1) as Id<"conversion">;
    statusStore.addConversion(conversionId, "USD", "approved");
    const ctx = ctxWith();
    const clawback = {
      conversionId,
      externalAdjustmentId: "adj-1",
      deltaMinor: -2_000n,
      currency: "USD" as const,
      reason: "clawback",
      reportedAt: sourceAt,
    };

    expect(await recordConversionAdjustment(ctx, statusStore, clawback)).toMatchObject({
      ok: true,
      value: { outcome: "recorded" },
    });
    expect(await recordConversionAdjustment(ctx, statusStore, clawback)).toMatchObject({
      ok: true,
      value: { outcome: "duplicate" },
    });
    expect(statusStore.adjustments.map((a) => [a.externalAdjustmentId, a.deltaMinor])).toEqual([["adj-1", -2_000n]]);
  });

  test("[M5] CT-020 unmatched conversion: import processes", async () => {
    const importStore = new FakeConversionImportStore();
    const ctx = ctxWith();

    const imported = await importConversionBatch(
      ctx,
      importStore,
      batch(digestC, [row({ externalRowRef: "txn-unmatched", subId: "sub-nobody" })]),
    );

    expect(imported).toMatchObject({ ok: true, value: { outcome: "imported", counts: { created: 1 } } });
    expect(importStore.rows).toHaveLength(1);
  });

  test("[M5] CT-020 unmatched conversion is staged as an exception, not assigned to a publisher", async () => {
    const otherPublisher = fixtureId("publisher", 2) as Id<"publisher">;
    const clicks = new FakeAttributionClickStore();
    // Another publisher's click exists, but under a different sub ID. Matching must not borrow it.
    clicks.addClick("sub-other", {
      dedupKey: "click-1",
      linkId: "lnk_1",
      publisherId: otherPublisher,
      occurredAt: new Date("2026-09-30T12:00:00Z"),
    });
    const conversionId = fixtureId("conversion", 7) as Id<"conversion">;

    const unknownSub = await matchConversion(clicks, {
      conversionId,
      subId: "sub-nobody",
      occurredAt: new Date(occurredAt),
    });
    const missingSub = await matchConversion(clicks, { conversionId, subId: null, occurredAt: new Date(occurredAt) });

    for (const result of [unknownSub, missingSub]) {
      expect(result).toEqual({ kind: "exception", conversionId, reason: "no_click" });
      expect(result).not.toHaveProperty("publisherId");
    }
  });
});
