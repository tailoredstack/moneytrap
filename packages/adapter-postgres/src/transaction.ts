import { type Kysely, Transaction } from "kysely";

// One transaction per action. Kysely commits when the callback resolves and rolls back on throw.
export async function withTx<DB, T>(db: Kysely<DB>, fn: (tx: Transaction<DB>) => Promise<T>): Promise<T> {
  if (db instanceof Transaction) {
    throw new Error("nested transactions are not supported");
  }
  return db.transaction().execute(fn);
}
