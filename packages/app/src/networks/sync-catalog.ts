import { createHash } from "node:crypto";
import { type ProgramFactPayload, validateSourceIdentity } from "@moneytrap/domain";
import type { CatalogSyncStore, QuarantineReason, SyncCursor, SyncScope } from "../ports/catalog-sync-store";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type {
  ConnectorFailure,
  ConnectorResult,
  NetworkConnector,
  Page,
  SourceIdentity,
} from "../ports/network-connector";

// A catalog whose last completed pass is older than this is marked data_stale (blueprint §8: source data ≤ 24 h old).
export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface SyncDeps {
  connector: NetworkConnector;
  store: CatalogSyncStore;
  clock: Clock;
  ids: IdGenerator;
}

export interface SyncTally {
  created: number;
  revised: number;
  unchanged: number;
  quarantined: number;
}

export interface SyncCatalogValue {
  advertisers: SyncTally;
  programs: SyncTally;
  // Fields the upstream sent that the catalog does not use. They are counted and dropped; the record is still accepted.
  unknownFields: number;
  // The freshness instant of the last completed advertiser pass, or null if none has completed.
  watermark: Date | null;
  dataStale: boolean;
}

// A failure is returned as the connector reported it, so the caller can retry temporarily_unavailable and stop on
// not_authorized. A failed sync never reports a partial pass as complete.
export type SyncCatalogResult = { ok: true; value: SyncCatalogValue } | { ok: false; failure: ConnectorFailure };

export function isCatalogStale(watermark: Date | null, now: Date): boolean {
  if (watermark === null) return true;
  return now.getTime() - watermark.getTime() > CATALOG_MAX_AGE_MS;
}

// Pulls every advertiser, then every program of every stored advertiser, saving the cursor after each page. An
// interrupted run resumes from the saved cursor, and a replayed page changes nothing because each revision is compared
// with the latest one before it is written (TP-W4-013).
export async function syncCatalog(deps: SyncDeps, input: { networkId: string }): Promise<SyncCatalogResult> {
  const { connector, store, clock, ids } = deps;
  const { networkId } = input;

  // Credentials are checked first. A disabled credential stops the sync before any catalog write (TP-W4-002, CT-009).
  const connection = await guarded(() => connector.validateConnection());
  if (!connection.ok) return { ok: false, failure: typedFailure(connection.failure) };

  const advertisers = emptyTally();
  const programs = emptyTally();
  const counter = { unknownFields: 0 };

  const advertiserPass = await drain<unknown>({
    store,
    networkId,
    scope: "advertisers",
    fetchPage: (cursor) => connector.discoverAdvertisers({ cursor }),
    handle: async (item, observedAt) => {
      const checked = validateAdvertiser(item);
      if (!checked.ok) {
        await store.quarantine({
          id: quarantineId(networkId, "advertisers", checked.reason, item),
          networkId,
          scope: "advertisers",
          sourceId: checked.sourceId,
          reason: checked.reason,
          payload: item,
          observedAt,
        });
        advertisers.quarantined++;
        return;
      }
      counter.unknownFields += checked.unknownFields;
      const outcome = await store.upsertAdvertiser({
        id: ids.next("advertiser"),
        networkId,
        ...checked.value,
        observedAt,
      });
      advertisers[outcome]++;
    },
    clock,
  });
  if (!advertiserPass.ok) return advertiserPass;

  for (const advertiserSourceId of await store.listAdvertiserSourceIds(networkId)) {
    const scope: SyncScope = `programs:${advertiserSourceId}`;
    const programPass = await drain<unknown>({
      store,
      networkId,
      scope,
      fetchPage: (cursor) => connector.discoverPrograms({ advertiserSourceId, cursor }),
      handle: async (item, observedAt) => {
        const checked = validateProgram(item);
        const quarantine = async (reason: QuarantineReason, sourceId: string | null) => {
          await store.quarantine({
            id: quarantineId(networkId, scope, reason, item),
            networkId,
            scope,
            sourceId,
            reason,
            payload: item,
            observedAt,
          });
          programs.quarantined++;
        };
        if (!checked.ok) return quarantine(checked.reason, checked.sourceId);
        // A program belongs to the advertiser whose pass returned it. A record that names another one is held, so the
        // cursor for this scope cannot attach it elsewhere.
        if (checked.value.advertiserSourceId !== advertiserSourceId)
          return quarantine("invalid_field", checked.value.sourceId);
        counter.unknownFields += checked.unknownFields;
        const outcome = await store.upsertProgram({
          id: ids.next("program"),
          networkId,
          advertiserSourceId: checked.value.advertiserSourceId,
          sourceId: checked.value.sourceId,
          revision: checked.value.revision,
          payload: checked.value.payload,
          observedAt,
        });
        // The advertiser row is missing, so the program has nowhere to attach. It is held, not dropped.
        if (outcome === null) return quarantine("unknown_advertiser", checked.value.sourceId);
        programs[outcome]++;
      },
      clock,
    });
    if (!programPass.ok) return programPass;
  }

  const watermark = advertiserPass.watermark;
  return {
    ok: true,
    value: {
      advertisers,
      programs,
      unknownFields: counter.unknownFields,
      watermark,
      dataStale: isCatalogStale(watermark, clock.now()),
    },
  };
}

// The ID is derived from the held record, so a replayed page or a repeat run writes the same row and no second alert.
function quarantineId(networkId: string, scope: SyncScope, reason: QuarantineReason, payload: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([networkId, scope, reason, payload]))
    .digest("hex");
  return `qtn_${digest.slice(0, 40)}`;
}

// A connector that throws instead of returning a ConnectorFailure is an adapter bug. The thrown error is discarded, so
// its message cannot reach the caller. The sync reports a retryable failure, which is bounded by the worker's attempts.
async function guarded<T>(call: () => Promise<ConnectorResult<T>>): Promise<ConnectorResult<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: null } };
  }
}

// Rebuilds the failure from its typed fields only. An adapter that attaches an upstream message or body to the failure
// cannot pass that text through the sync result, log line, or error (TP-W4-007, CT-009).
function typedFailure(failure: ConnectorFailure): ConnectorFailure {
  if (failure.state === "temporarily_unavailable") {
    const { retryAfterSeconds } = failure;
    const valid = typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0;
    return { state: "temporarily_unavailable", retryAfterSeconds: valid ? retryAfterSeconds : null };
  }
  // An unrecognized state is treated as not_authorized, so an unexpected value is never passed through.
  if (failure.state === "unsupported") return { state: "unsupported" };
  return { state: "not_authorized" };
}

function emptyTally(): SyncTally {
  return { created: 0, revised: 0, unchanged: 0, quarantined: 0 };
}

// Pages through one scope. Each page's items are handled before the cursor moves past them, so a failure on any item
// leaves the cursor at the page that was not finished.
async function drain<T>(args: {
  store: CatalogSyncStore;
  networkId: string;
  scope: SyncScope;
  fetchPage: (cursor: string | null) => Promise<ConnectorResult<Page<T>>>;
  handle: (item: T, observedAt: Date) => Promise<void>;
  clock: Clock;
}): Promise<{ ok: true; watermark: Date } | { ok: false; failure: ConnectorFailure }> {
  const { store, networkId, scope, fetchPage, handle, clock } = args;
  const loaded: SyncCursor = await store.loadCursor(networkId, scope);
  let cursor = loaded.cursor;
  for (;;) {
    const page = await guarded(() => fetchPage(cursor));
    if (!page.ok) return { ok: false, failure: typedFailure(page.failure) };
    const observedAt = clock.now();
    for (const item of page.value.items) await handle(item, observedAt);
    if (page.value.nextCursor === null) {
      await store.saveCursor(networkId, scope, { cursor: null, watermark: page.value.watermark });
      return { ok: true, watermark: page.value.watermark };
    }
    cursor = page.value.nextCursor;
    await store.saveCursor(networkId, scope, { cursor, watermark: loaded.watermark });
  }
}

type Checked<T> =
  | { ok: true; value: T; unknownFields: number }
  | { ok: false; reason: QuarantineReason; sourceId: string | null };

const ADVERTISER_FIELDS = new Set(["sourceId", "revision", "name"]);
const PROGRAM_FIELDS = new Set([
  "sourceId",
  "revision",
  "advertiserSourceId",
  "name",
  "terms",
  "eligibility",
  "countries",
  "channels",
  "approval",
]);
const APPROVAL_STATES = new Set(["approved", "pending", "rejected"]);

// Validates the identity first, so a record with no identity is quarantined before any other field is read. A field
// with the wrong shape quarantines the whole record; nothing is repaired or defaulted.
function validateAdvertiser(raw: unknown): Checked<SourceIdentity & { name: string }> {
  const record = asRecord(raw);
  if (!record) return { ok: false, reason: "invalid_field", sourceId: null };
  const identity = readIdentity(record);
  if (!identity.ok) return { ok: false, reason: "missing_identity", sourceId: identity.sourceId };
  if (typeof record.name !== "string") return { ok: false, reason: "invalid_field", sourceId: identity.value.sourceId };
  return {
    ok: true,
    value: { ...identity.value, name: record.name },
    unknownFields: countUnknown(record, ADVERTISER_FIELDS),
  };
}

function validateProgram(raw: unknown): Checked<{
  sourceId: string;
  revision: string;
  advertiserSourceId: string;
  payload: ProgramFactPayload;
}> {
  const record = asRecord(raw);
  if (!record) return { ok: false, reason: "invalid_field", sourceId: null };
  const identity = readIdentity(record);
  if (!identity.ok) return { ok: false, reason: "missing_identity", sourceId: identity.sourceId };
  const sourceId = identity.value.sourceId;
  const fail = (reason: QuarantineReason) => ({ ok: false as const, reason, sourceId });

  if (typeof record.advertiserSourceId !== "string" || record.advertiserSourceId.trim() === "") {
    return fail("invalid_field");
  }
  if (typeof record.name !== "string" || typeof record.terms !== "string") return fail("invalid_field");
  if (record.eligibility !== null && typeof record.eligibility !== "string") return fail("invalid_field");
  if (!isStringArray(record.countries) || !isStringArray(record.channels)) return fail("invalid_field");
  // The approval state is never inferred. A missing or unknown value quarantines the record, so it cannot be approved.
  if (!("approval" in record)) return fail("invalid_approval");
  const approval = record.approval;
  if (approval !== null && (typeof approval !== "string" || !APPROVAL_STATES.has(approval))) {
    return fail("invalid_approval");
  }

  return {
    ok: true,
    value: {
      ...identity.value,
      advertiserSourceId: record.advertiserSourceId,
      payload: {
        name: record.name,
        terms: record.terms,
        eligibility: record.eligibility,
        countries: [...record.countries],
        channels: [...record.channels],
        approval: approval as ProgramFactPayload["approval"],
      },
    },
    unknownFields: countUnknown(record, PROGRAM_FIELDS),
  };
}

function readIdentity(
  record: Record<string, unknown>,
): { ok: true; value: SourceIdentity } | { ok: false; sourceId: string | null } {
  const sourceId = typeof record.sourceId === "string" ? record.sourceId : null;
  const revision = typeof record.revision === "string" ? record.revision : null;
  if (sourceId === null || revision === null) return { ok: false, sourceId };
  if (!validateSourceIdentity({ sourceId, revision }).ok) return { ok: false, sourceId };
  return { ok: true, value: { sourceId, revision } };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function countUnknown(record: Record<string, unknown>, known: Set<string>): number {
  return Object.keys(record).filter((key) => !known.has(key)).length;
}
