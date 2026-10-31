import type { ProgramFactPayload } from "@moneytrap/domain";

// The sync keeps one cursor per scope: the advertiser list of a network, or the program list of one advertiser.
// A cursor of null means the next pass starts at the first page.
export type SyncScope = "advertisers" | `programs:${string}`;

export interface SyncCursor {
  // The page the next call resumes from. Null when no pass is in progress.
  cursor: string | null;
  // The freshness instant the upstream reported on the last completed pass. Null until a pass completes.
  watermark: Date | null;
}

export type FactOutcome = "created" | "revised" | "unchanged";

export type QuarantineReason = "missing_identity" | "invalid_field" | "unknown_advertiser" | "invalid_approval";

export interface AdvertiserWrite {
  id: string;
  networkId: string;
  sourceId: string;
  revision: string;
  name: string;
  observedAt: Date;
}

export interface ProgramWrite {
  id: string;
  networkId: string;
  advertiserSourceId: string;
  sourceId: string;
  revision: string;
  payload: ProgramFactPayload;
  observedAt: Date;
}

export interface QuarantineWrite {
  id: string;
  networkId: string;
  scope: SyncScope;
  sourceId: string | null;
  reason: QuarantineReason;
  // The record as the upstream sent it, kept for review. It is never written to the source-fact tables.
  payload: unknown;
  observedAt: Date;
}

// The adapter commits each write with its outbox event (a quarantine alert) in one transaction. Cursor saves are
// separate; a crash before a save replays the page, and the revision check makes the replay a no-op.
export interface CatalogSyncStore {
  loadCursor(networkId: string, scope: SyncScope): Promise<SyncCursor>;
  saveCursor(networkId: string, scope: SyncScope, state: SyncCursor): Promise<void>;
  // Advertiser source IDs the network has reported so far, in a stable order.
  listAdvertiserSourceIds(networkId: string): Promise<string[]>;
  upsertAdvertiser(write: AdvertiserWrite): Promise<FactOutcome>;
  // null when the advertiser has not been stored, so the program cannot be attached to it.
  upsertProgram(write: ProgramWrite): Promise<FactOutcome | null>;
  quarantine(write: QuarantineWrite): Promise<void>;
}
