import type {
  AdvertiserWrite,
  CatalogSyncStore,
  FactOutcome,
  ProgramWrite,
  QuarantineWrite,
  SyncCursor,
} from "@moneytrap/app/src/ports/catalog-sync-store";
import { type Kysely, sql } from "kysely";
import { appendOutboxEvent } from "../outbox/writer";
import { withTx } from "../transaction";
import { createSourceFactStore } from "./source-fact-store";

interface CursorRow {
  cursor: string | null;
  watermark: Date | null;
}

// Cursor saves are single-row upserts. Fact writes go through the source-fact store, which locks the parent row and
// appends a revision only when the content changed. Quarantine writes the held record and its alert event together.
export function createCatalogSyncStore(db: Kysely<unknown>): CatalogSyncStore {
  const facts = createSourceFactStore(db);

  return {
    async loadCursor(networkId, scope) {
      const result = await sql<CursorRow>`select cursor, watermark from catalog_sync_cursors
        where network_id = ${networkId} and scope = ${scope}`.execute(db);
      const row = result.rows[0];
      return row ? { cursor: row.cursor, watermark: row.watermark } : { cursor: null, watermark: null };
    },

    async saveCursor(networkId, scope, state: SyncCursor) {
      await sql`insert into catalog_sync_cursors (network_id, scope, cursor, watermark, updated_at)
        values (${networkId}, ${scope}, ${state.cursor}, ${state.watermark}, clock_timestamp())
        on conflict (network_id, scope)
        do update set cursor = excluded.cursor, watermark = excluded.watermark, updated_at = excluded.updated_at`.execute(
        db,
      );
    },

    async listAdvertiserSourceIds(networkId) {
      const result = await sql<{ external_id: string }>`select external_id from network_advertisers
        where network_id = ${networkId} order by external_id`.execute(db);
      return result.rows.map((row) => row.external_id);
    },

    async upsertAdvertiser(write: AdvertiserWrite): Promise<FactOutcome> {
      const result = await facts.upsertNetworkAdvertiser({
        id: write.id,
        networkId: write.networkId,
        sourceId: write.sourceId,
        sourceRevision: write.revision,
        payload: { name: write.name },
        observedAt: write.observedAt,
      });
      // The identity is validated upstream, so a null here means a programming error, not a bad record.
      if (!result) throw new Error("advertiser upsert rejected a validated identity");
      return result.outcome;
    },

    async upsertProgram(write: ProgramWrite): Promise<FactOutcome | null> {
      const parent = await sql<{ id: string }>`select id from network_advertisers
        where network_id = ${write.networkId} and external_id = ${write.advertiserSourceId}`.execute(db);
      const networkAdvertiserId = parent.rows[0]?.id;
      if (!networkAdvertiserId) return null;
      const result = await facts.upsertProgram({
        id: write.id,
        networkAdvertiserId,
        sourceId: write.sourceId,
        sourceRevision: write.revision,
        payload: write.payload,
        observedAt: write.observedAt,
      });
      if (!result) throw new Error("program upsert rejected a validated identity");
      return result.outcome;
    },

    async quarantine(write: QuarantineWrite) {
      // The payload is stored as its JSON text, not jsonb, so an escape that jsonb rejects cannot stall the sync.
      // A replayed write hits the primary key and emits nothing, so each held record raises one alert.
      await withTx(db, async (tx) => {
        const inserted = await sql<{ id: string }>`insert into catalog_quarantine
            (id, network_id, scope, source_id, reason, payload, observed_at, created_at)
          values (${write.id}, ${write.networkId}, ${write.scope}, ${write.sourceId}, ${write.reason},
            ${JSON.stringify(write.payload)}, ${write.observedAt}, clock_timestamp())
          on conflict (id) do nothing
          returning id`.execute(tx);
        if (inserted.rows.length === 0) return;
        await appendOutboxEvent(tx, {
          id: `evt_${write.id}`,
          topic: "catalog.record_quarantined",
          aggregateId: write.networkId,
          aggregateVersion: 0,
          payload: { quarantineId: write.id, networkId: write.networkId, scope: write.scope, reason: write.reason },
        });
      });
    },
  };
}
