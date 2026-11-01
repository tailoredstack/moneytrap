import type {
  ReceiptRecord,
  RecordReceiptOutcome,
  SettlementReceiptStore,
} from "@moneytrap/app/src/ports/settlement-receipt-store";
import type { CurrencyCode, Id } from "@moneytrap/domain";
import { type Kysely, sql } from "kysely";

interface ReceiptRow {
  id: string;
  network_id: string;
  external_ref: string;
  gross_minor: string;
  currency: string;
  received_at: Date;
  state: string;
  object_ref: string | null;
}

// Settlement receipts (DM-041, WP-7.1). The insert and the lookup run on the same connection, and a stored row is never
// updated, so a concurrent import of one reference gets either the row it wrote or the row that won the insert.
export function createSettlementReceiptStore(db: Kysely<unknown>): SettlementReceiptStore {
  return {
    async record(receipt: ReceiptRecord): Promise<RecordReceiptOutcome> {
      // gross_minor is passed as a string: the pg driver cannot serialize a bigint parameter.
      const inserted = await sql<{ id: string }>`insert into settlement_receipts
          (id, network_id, external_ref, gross_minor, currency, received_at, state, object_ref)
        values (${receipt.id}, ${receipt.networkId}, ${receipt.externalRef}, ${receipt.grossMinor.toString()},
          ${receipt.currency}, ${receipt.receivedAt}, ${receipt.state}, ${receipt.objectRef})
        on conflict (network_id, external_ref) do nothing
        returning id`.execute(db);
      if (inserted.rows[0]) return { kind: "created" };

      const found =
        await sql<ReceiptRow>`select id, network_id, external_ref, gross_minor, currency, received_at, state, object_ref
        from settlement_receipts where network_id = ${receipt.networkId} and external_ref = ${receipt.externalRef}`.execute(
          db,
        );
      const row = found.rows[0];
      if (!row) throw new Error("record: receipt missing after conflict");
      return { kind: "existing", existing: toRecord(row) };
    },
  };
}

function toRecord(row: ReceiptRow): ReceiptRecord {
  return {
    id: row.id as Id<"settlementReceipt">,
    networkId: row.network_id,
    externalRef: row.external_ref,
    grossMinor: BigInt(row.gross_minor),
    currency: row.currency as CurrencyCode,
    receivedAt: row.received_at,
    state: row.state,
    objectRef: row.object_ref,
  };
}
