import type {
  AdvertiserWrite,
  CatalogSyncStore,
  FactOutcome,
  ProgramWrite,
  QuarantineWrite,
  SyncCursor,
  SyncScope,
} from "@moneytrap/app/src/ports/catalog-sync-store";
import { type AdvertiserFactPayload, decideRevision, type ProgramFactPayload } from "@moneytrap/domain";

interface StoredFact<T> {
  id: string;
  sourceId: string;
  revisions: { sourceRevision: string; payload: T; observedAt: Date }[];
}

/** In-memory reference adapter for the catalog sync store. Revisions follow the same decideRevision rule as Postgres. */
export class FakeCatalogSyncStore implements CatalogSyncStore {
  readonly advertisers = new Map<string, StoredFact<AdvertiserFactPayload> & { networkId: string }>();
  readonly programs = new Map<string, StoredFact<ProgramFactPayload> & { advertiserSourceId: string }>();
  readonly quarantined: QuarantineWrite[] = [];
  private readonly cursors = new Map<string, SyncCursor>();

  async loadCursor(networkId: string, scope: SyncScope): Promise<SyncCursor> {
    return this.cursors.get(cursorKey(networkId, scope)) ?? { cursor: null, watermark: null };
  }

  async saveCursor(networkId: string, scope: SyncScope, state: SyncCursor): Promise<void> {
    this.cursors.set(cursorKey(networkId, scope), { ...state });
  }

  async listAdvertiserSourceIds(networkId: string): Promise<string[]> {
    return [...this.advertisers.values()]
      .filter((fact) => fact.networkId === networkId)
      .map((fact) => fact.sourceId)
      .sort();
  }

  async upsertAdvertiser(write: AdvertiserWrite): Promise<FactOutcome> {
    const key = `${write.networkId}:${write.sourceId}`;
    const existing = this.advertisers.get(key);
    const latest = existing?.revisions.at(-1) ?? null;
    const decision = decideRevision(latest, { sourceRevision: write.revision, payload: { name: write.name } });
    if (decision.kind === "unchanged") return "unchanged";
    const revision = { sourceRevision: write.revision, payload: { name: write.name }, observedAt: write.observedAt };
    if (existing) existing.revisions.push(revision);
    else
      this.advertisers.set(key, {
        id: write.id,
        networkId: write.networkId,
        sourceId: write.sourceId,
        revisions: [revision],
      });
    return decision.kind === "create" ? "created" : "revised";
  }

  async upsertProgram(write: ProgramWrite): Promise<FactOutcome | null> {
    const parent = this.advertisers.get(`${write.networkId}:${write.advertiserSourceId}`);
    if (!parent) return null;
    // Keyed by advertiser as well, to match the adapter's (network_advertiser_id, external_id) uniqueness.
    const key = `${write.networkId}:${write.advertiserSourceId}:${write.sourceId}`;
    const existing = this.programs.get(key);
    const latest = existing?.revisions.at(-1) ?? null;
    const decision = decideRevision(latest, { sourceRevision: write.revision, payload: write.payload });
    if (decision.kind === "unchanged") return "unchanged";
    const revision = { sourceRevision: write.revision, payload: write.payload, observedAt: write.observedAt };
    if (existing) existing.revisions.push(revision);
    else
      this.programs.set(key, {
        id: write.id,
        sourceId: write.sourceId,
        advertiserSourceId: write.advertiserSourceId,
        revisions: [revision],
      });
    return decision.kind === "create" ? "created" : "revised";
  }

  async quarantine(write: QuarantineWrite): Promise<void> {
    // Same rule as the adapter: a held record is written once, keyed by its ID.
    if (this.quarantined.some((held) => held.id === write.id)) return;
    this.quarantined.push({ ...write });
  }

  async invalidateProgramApproval(networkId: string, advertiserSourceId: string, sourceId: string): Promise<void> {
    const fact = this.programs.get(`${networkId}:${advertiserSourceId}:${sourceId}`);
    const latest = fact?.revisions.at(-1);
    if (latest) latest.payload = { ...latest.payload, approval: null };
  }
}

function cursorKey(networkId: string, scope: SyncScope): string {
  return `${networkId}|${scope}`;
}
