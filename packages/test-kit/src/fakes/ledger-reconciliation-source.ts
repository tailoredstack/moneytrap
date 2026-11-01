import type {
  LedgerReconciliationSource,
  LedgerSnapshot,
  ReconciliationAccount,
  ReconciliationJournal,
} from "@moneytrap/app/src/ports/ledger-reconciliation-source";

/** In-memory reference adapter for the reconciliation source. It stores whatever it is given, including a ledger that breaks the invariants, so tests can seed a variance. */
export class FakeLedgerReconciliationSource implements LedgerReconciliationSource {
  private readonly accounts: ReconciliationAccount[] = [];
  private readonly journals: ReconciliationJournal[] = [];

  addAccount(account: ReconciliationAccount): void {
    this.accounts.push({ ...account });
  }

  addJournal(journal: ReconciliationJournal): void {
    this.journals.push({ ...journal, postings: journal.postings.map((posting) => ({ ...posting })) });
  }

  /** Returns a copy, so a caller that changes the snapshot cannot change the stored ledger. */
  async snapshot(): Promise<LedgerSnapshot> {
    return {
      accounts: this.accounts.map((account) => ({ ...account })),
      journals: this.journals.map((journal) => ({ ...journal, postings: journal.postings.map((p) => ({ ...p })) })),
    };
  }
}
