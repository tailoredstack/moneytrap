import type { Kysely, Transaction } from "kysely";
import type { Clock } from "./ports/clock";
import type { IdGenerator } from "./ports/id-generator";

// Actions and queries receive one context. An action may replace db with its transaction
// when calling another action, so all writes share the same atomic unit.
export interface Ctx<DB = Record<string, never>> {
  db: Kysely<DB> | Transaction<DB>;
  clock: Clock;
  ids: IdGenerator;
  actor: { type: string; id: string | null };
}
