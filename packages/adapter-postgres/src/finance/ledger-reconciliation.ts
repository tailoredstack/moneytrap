import type { LedgerReconciliationSource, LedgerSnapshot } from "@moneytrap/app/src/ports/ledger-reconciliation-source";
import { type Kysely, sql } from "kysely";

interface AccountRow {
  id: string;
  currency: string;
}

interface JournalRow {
  id: string;
  reversal_of: string | null;
}

interface PostingRow {
  id: string;
  journal_id: string;
  account_id: string;
  side: "debit" | "credit";
  amount: string;
  currency: string;
}

// Reads the ledger tables (DM-038 to DM-040, WP-X.3) for the nightly reconciliation. All three reads run in one
// repeatable-read, read-only transaction: they see one snapshot, so a journal that commits meanwhile is wholly in it or
// not in it, and the database refuses any write this code might attempt. The statements are selects only.
export function createLedgerReconciliationSource(db: Kysely<unknown>): LedgerReconciliationSource {
  return {
    async snapshot(): Promise<LedgerSnapshot> {
      return db
        .transaction()
        .setIsolationLevel("repeatable read")
        .execute(async (tx) => {
          await sql`set transaction read only`.execute(tx);
          const accounts = await sql<AccountRow>`select id, currency from accounts`.execute(tx);
          const journals = await sql<JournalRow>`select id, reversal_of from journals`.execute(tx);
          // amount is read as text: the pg driver returns a bigint column as a string, and a number would lose digits.
          const postings = await sql<PostingRow>`
            select id, journal_id, account_id, side, amount::text as amount, currency from postings`.execute(tx);

          const byJournal = new Map<string, LedgerSnapshot["journals"][number]["postings"]>();
          for (const row of postings.rows) {
            const list = byJournal.get(row.journal_id) ?? [];
            list.push({
              id: row.id,
              accountId: row.account_id,
              side: row.side,
              amountMinor: BigInt(row.amount),
              currency: row.currency,
            });
            byJournal.set(row.journal_id, list);
          }

          return {
            accounts: accounts.rows.map((row) => ({ id: row.id, currency: row.currency })),
            journals: journals.rows.map((row) => ({
              id: row.id,
              reversalOf: row.reversal_of,
              postings: byJournal.get(row.id) ?? [],
            })),
          };
        });
    },
  };
}
