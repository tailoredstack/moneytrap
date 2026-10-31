import type { Kysely, Transaction } from "kysely";
import type { Clock } from "./ports/clock";
import type { IdGenerator } from "./ports/id-generator";

// Actions and queries receive one context. An outer action passes its transaction to a
// called action through db; the called action uses db directly instead of opening another
// transaction. withTx rejects nested calls (TP-W1-017).
export interface Ctx<DB = Record<string, never>> {
  db: Kysely<DB> | Transaction<DB>;
  clock: Clock;
  ids: IdGenerator;
  actor: { type: string; id: string | null };
}
