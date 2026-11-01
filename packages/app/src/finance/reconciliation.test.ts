import { describe, expect, test } from "bun:test";
import type { Ctx } from "../ctx";
import type {
  LedgerReconciliationSource,
  LedgerSnapshot,
  ReconciliationAccount,
  ReconciliationJournal,
  ReconciliationPosting,
} from "../ports/ledger-reconciliation-source";
import { reconcileLedger } from "./reconciliation";

const asOf = "2026-11-02T01:00:00.000Z";
const ctx = {
  db: undefined as never,
  clock: { now: () => new Date(asOf) },
  ids: undefined as never,
  actor: { type: "system", id: null },
} satisfies Ctx;

// The app package has no test-kit dependency, so the source is local. The fake in test-kit runs the same cases against the
// same query (packages/test-kit/src/fakes/ledger-reconciliation-source.test.ts).
class InMemoryLedger implements LedgerReconciliationSource {
  readonly accounts: ReconciliationAccount[] = [];
  readonly journals: ReconciliationJournal[] = [];

  async snapshot(): Promise<LedgerSnapshot> {
    return structuredClone({ accounts: this.accounts, journals: this.journals });
  }
}

function posting(
  id: string,
  accountId: string,
  side: "debit" | "credit",
  amountMinor: bigint,
  currency = "USD",
): ReconciliationPosting {
  return { id, accountId, side, amountMinor, currency };
}

function journal(
  id: string,
  postings: ReconciliationPosting[],
  reversalOf: string | null = null,
): ReconciliationJournal {
  return { id, reversalOf, postings };
}

// Two USD accounts and one JPY account, so a test can break each rule on its own.
function ledger(...journals: ReconciliationJournal[]) {
  const source = new InMemoryLedger();
  source.accounts.push(
    { id: "cash", currency: "USD" },
    { id: "revenue", currency: "USD" },
    { id: "yen", currency: "JPY" },
  );
  source.journals.push(...journals);
  return source;
}

const sale = journal("j1", [posting("p1", "cash", "debit", 1_000n), posting("p2", "revenue", "credit", 1_000n)]);

describe("ledger reconciliation (WP-X.3)", () => {
  test("an empty ledger is clean", async () => {
    const report = await reconcileLedger(ctx, ledger());

    expect(report.status).toBe("clean");
    expect(report.findings).toEqual([]);
    expect(report.counts).toEqual({ accounts: 3, journals: 0, postings: 0 });
    expect(report.asOf).toEqual(new Date(asOf));
  });

  test("a balanced journal and its exact reversal are clean, and the control totals match", async () => {
    const reversal = journal(
      "j2",
      [posting("p3", "cash", "credit", 1_000n), posting("p4", "revenue", "debit", 1_000n)],
      "j1",
    );
    const report = await reconcileLedger(ctx, ledger(sale, reversal));

    expect(report.status).toBe("clean");
    expect(report.unexplainedVariance).toEqual([]);
    expect(report.counts).toEqual({ accounts: 3, journals: 2, postings: 4 });
    expect(report.controlTotals).toEqual([{ currency: "USD", debitMinor: 2_000n, creditMinor: 2_000n }]);
  });

  test("an unbalanced journal reports its delta and the gross variance in minor units", async () => {
    const short = journal("j1", [posting("p1", "cash", "debit", 1_001n), posting("p2", "revenue", "credit", 1_000n)]);
    const report = await reconcileLedger(ctx, ledger(short));

    expect(report.status).toBe("variance");
    expect(report.findings).toEqual([
      expect.objectContaining({ code: "journal_unbalanced", journalId: "j1", currency: "USD", deltaMinor: 1n }),
    ]);
    expect(report.unexplainedVariance).toEqual([{ currency: "USD", grossMinor: 1n }]);
  });

  test("opposite imbalances in two journals add up in the gross variance instead of cancelling", async () => {
    const over = journal("j1", [posting("p1", "cash", "debit", 1_005n), posting("p2", "revenue", "credit", 1_000n)]);
    const under = journal("j2", [posting("p3", "cash", "debit", 1_000n), posting("p4", "revenue", "credit", 1_005n)]);
    const report = await reconcileLedger(ctx, ledger(over, under));

    expect(report.findings.map((f) => [f.journalId, f.deltaMinor])).toEqual([
      ["j1", 5n],
      ["j2", -5n],
    ]);
    expect(report.unexplainedVariance).toEqual([{ currency: "USD", grossMinor: 10n }]);
  });

  test("currencies are balanced one by one and never netted against each other", async () => {
    const crossed = journal("j1", [posting("p1", "cash", "debit", 500n), posting("p2", "yen", "credit", 500n, "JPY")]);
    const report = await reconcileLedger(ctx, ledger(crossed));

    expect(report.findings.map((f) => [f.code, f.currency, f.deltaMinor])).toEqual([
      ["journal_unbalanced", "JPY", -500n],
      ["journal_unbalanced", "USD", 500n],
    ]);
    expect(report.unexplainedVariance).toEqual([
      { currency: "JPY", grossMinor: 500n },
      { currency: "USD", grossMinor: 500n },
    ]);
  });

  test("amounts past 2^53 are compared exactly", async () => {
    const big = 9_007_199_254_740_993n;
    const exact = journal("j1", [posting("p1", "cash", "debit", big), posting("p2", "revenue", "credit", big)]);
    const off = journal("j2", [posting("p3", "cash", "debit", big), posting("p4", "revenue", "credit", big - 1n)]);

    expect((await reconcileLedger(ctx, ledger(exact))).status).toBe("clean");
    const report = await reconcileLedger(ctx, ledger(off));
    expect(report.findings).toEqual([expect.objectContaining({ code: "journal_unbalanced", deltaMinor: 1n })]);
  });

  test("a journal with fewer than two postings is a finding", async () => {
    const lone = journal("j1", [posting("p1", "cash", "debit", 1n)]);
    const report = await reconcileLedger(ctx, ledger(lone));

    expect(report.findings.map((f) => f.code)).toEqual(["journal_too_few_postings", "journal_unbalanced"]);
  });

  test("a zero or negative posting amount is a finding", async () => {
    const zero = journal("j1", [posting("p1", "cash", "debit", 0n), posting("p2", "revenue", "credit", 0n)]);
    const report = await reconcileLedger(ctx, ledger(zero));

    expect(report.findings.map((f) => [f.code, f.postingId])).toEqual([
      ["posting_non_positive_amount", "p1"],
      ["posting_non_positive_amount", "p2"],
    ]);
  });

  test("a posting on a missing account, or in a currency its account does not hold, is a finding", async () => {
    const stray = journal("j1", [posting("p1", "nowhere", "debit", 100n), posting("p2", "yen", "credit", 100n, "USD")]);
    const report = await reconcileLedger(ctx, ledger(stray));

    expect(report.findings.map((f) => [f.code, f.postingId])).toEqual([
      ["posting_account_missing", "p1"],
      ["posting_currency_mismatch", "p2"],
    ]);
    expect(report.status).toBe("variance");
  });

  describe("reversals", () => {
    const mirror = (id: string, reversalOf: string, prefix: string) =>
      journal(
        id,
        [posting(`${prefix}1`, "cash", "credit", 1_000n), posting(`${prefix}2`, "revenue", "debit", 1_000n)],
        reversalOf,
      );

    test("a reversal of a journal that does not exist is a finding", async () => {
      const report = await reconcileLedger(ctx, ledger(mirror("j2", "gone", "r")));

      expect(report.findings.map((f) => f.code)).toEqual(["reversal_original_missing"]);
    });

    test("a reversal of a reversal is a finding", async () => {
      const report = await reconcileLedger(ctx, ledger(sale, mirror("j2", "j1", "r"), mirror("j3", "j2", "s")));

      expect(report.findings.map((f) => [f.code, f.journalId])).toContainEqual(["reversal_of_reversal", "j3"]);
    });

    test("a second reversal of one original is a finding", async () => {
      const report = await reconcileLedger(ctx, ledger(sale, mirror("j2", "j1", "r"), mirror("j3", "j1", "s")));

      expect(report.findings.map((f) => [f.code, f.journalId])).toEqual([["reversal_duplicate", "j3"]]);
    });

    test("a reversal for a different amount is not a mirror, even when it balances", async () => {
      const partial = journal(
        "j2",
        [posting("r1", "cash", "credit", 900n), posting("r2", "revenue", "debit", 900n)],
        "j1",
      );
      const report = await reconcileLedger(ctx, ledger(sale, partial));

      expect(report.findings.map((f) => f.code)).toEqual(["reversal_not_mirror"]);
    });

    test("a reversal that keeps the original sides is not a mirror", async () => {
      const same = journal(
        "j2",
        [posting("r1", "cash", "debit", 1_000n), posting("r2", "revenue", "credit", 1_000n)],
        "j1",
      );
      const report = await reconcileLedger(ctx, ledger(sale, same));

      expect(report.findings.map((f) => f.code)).toEqual(["reversal_not_mirror"]);
    });

    test("a reversal on other accounts is not a mirror", async () => {
      const elsewhere = journal(
        "j2",
        [posting("r1", "revenue", "credit", 1_000n), posting("r2", "cash", "debit", 1_000n)],
        "j1",
      );
      const report = await reconcileLedger(ctx, ledger(sale, elsewhere));

      expect(report.findings.map((f) => f.code)).toEqual(["reversal_not_mirror"]);
    });
  });

  test("it reads only: the source is unchanged and a second run gives the same report", async () => {
    const source = ledger(
      sale,
      journal("j2", [posting("p3", "cash", "debit", 7n), posting("p4", "revenue", "credit", 5n)]),
    );
    const before = await source.snapshot();

    const first = await reconcileLedger(ctx, source);
    const second = await reconcileLedger(ctx, source);

    expect(second).toEqual(first);
    expect(await source.snapshot()).toEqual(before);
  });

  test("findings come out in the same order whatever order the source returns journals in", async () => {
    const bad = (id: string, p: string) =>
      journal(id, [posting(`${p}1`, "cash", "debit", 2n), posting(`${p}2`, "revenue", "credit", 1n)]);
    const forward = await reconcileLedger(ctx, ledger(bad("j1", "a"), bad("j2", "b")));
    const backward = await reconcileLedger(ctx, ledger(bad("j2", "b"), bad("j1", "a")));

    expect(backward).toEqual(forward);
  });
});
