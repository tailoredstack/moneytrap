// One ledger account as the reconciliation reads it. The account holds a single currency (DM-038).
export interface ReconciliationAccount {
  id: string;
  currency: string;
}

// One posting as stored. Amounts are bigint minor units. The side carries the direction, and amount is expected to be
// positive (DM-040), so a stored zero or negative amount is itself a finding.
export interface ReconciliationPosting {
  id: string;
  accountId: string;
  side: "debit" | "credit";
  amountMinor: bigint;
  currency: string;
}

export interface ReconciliationJournal {
  id: string;
  reversalOf: string | null;
  postings: ReconciliationPosting[];
}

// A consistent read of the whole ledger. The adapter takes every table from one snapshot, so a journal that commits
// while the job runs is either wholly in it or not in it.
export interface LedgerSnapshot {
  accounts: ReconciliationAccount[];
  journals: ReconciliationJournal[];
}

// Read-only view of the ledger for the nightly reconciliation. There is no write method: reconciliation reports
// variance and never posts a correction.
export interface LedgerReconciliationSource {
  snapshot(): Promise<LedgerSnapshot>;
}
