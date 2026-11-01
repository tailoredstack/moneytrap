import { expect, test } from "bun:test";
import { reconcileLedger } from "@moneytrap/app/src/finance/reconciliation";
import { fixtureCtx } from "../fixtures/ctx";
import { FakeLedgerReconciliationSource } from "./ledger-reconciliation-source";

function seeded() {
  const source = new FakeLedgerReconciliationSource();
  source.addAccount({ id: "cash", currency: "USD" });
  source.addAccount({ id: "revenue", currency: "USD" });
  return source;
}

const ctx = fixtureCtx<Record<string, never>>(undefined as never);

test("the fake reports a balanced ledger as clean", async () => {
  const source = seeded();
  source.addJournal({
    id: "j1",
    reversalOf: null,
    postings: [
      { id: "p1", accountId: "cash", side: "debit", amountMinor: 100n, currency: "USD" },
      { id: "p2", accountId: "revenue", side: "credit", amountMinor: 100n, currency: "USD" },
    ],
  });

  expect((await reconcileLedger(ctx, source)).status).toBe("clean");
});

test("the fake keeps an unbalanced journal so a variance can be seeded", async () => {
  const source = seeded();
  source.addJournal({
    id: "j1",
    reversalOf: null,
    postings: [
      { id: "p1", accountId: "cash", side: "debit", amountMinor: 101n, currency: "USD" },
      { id: "p2", accountId: "revenue", side: "credit", amountMinor: 100n, currency: "USD" },
    ],
  });

  const report = await reconcileLedger(ctx, source);
  expect(report.grossImbalance).toEqual([{ currency: "USD", grossMinor: 1n }]);
});

test("a snapshot is a copy: changing it does not change the stored ledger", async () => {
  const source = seeded();
  source.addJournal({ id: "j1", reversalOf: null, postings: [] });

  const snapshot = await source.snapshot();
  snapshot.journals[0]?.postings.push({ id: "p1", accountId: "cash", side: "debit", amountMinor: 1n, currency: "USD" });
  snapshot.accounts.length = 0;

  const again = await source.snapshot();
  expect(again.journals[0]?.postings).toEqual([]);
  expect(again.accounts).toHaveLength(2);
});
