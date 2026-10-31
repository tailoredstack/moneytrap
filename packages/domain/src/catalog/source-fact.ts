import type { ErrorCode } from "../errors/codes";

// Source facts (DM-021, DM-022, spec §4.2). A network's advertiser or program is identified by the network's own ID
// and revision, never by a platform ID. Each change the network reports becomes a new revision, and earlier revisions
// are kept, so a correction or a replay can be traced back to what the network said at the time.

export interface AdvertiserFactPayload {
  name: string;
}

export interface ProgramFactPayload {
  name: string;
  terms: string;
  // The eligibility conditions as the network states them, not interpreted here (spec §6.1).
  eligibility: string | null;
  countries: readonly string[];
  channels: readonly string[];
  // null when the network does not expose approval state for the program.
  approval: "approved" | "pending" | "rejected" | null;
}

export type SourceIdentityResult = { ok: true } | { ok: false; code: ErrorCode };

// Both parts are needed for an upsert: the source ID is the match key, and the revision says whether anything changed.
export function validateSourceIdentity(input: { sourceId: string; revision: string }): SourceIdentityResult {
  if (input.sourceId.trim() === "" || input.revision.trim() === "") return { ok: false, code: "VALIDATION_FAILED" };
  return { ok: true };
}

export interface LatestRevision<T> {
  sourceRevision: string;
  payload: T;
}

export interface IncomingRevision<T> {
  sourceRevision: string;
  payload: T;
}

// create: the source record is new. unchanged: the same content, so no row is written (TP-W4-008). The upstream
// revision label alone does not make a new revision, because the content is what the platform acts on.
// revise: the content changed, so a new revision is kept beside the old one and records the label it arrived with.
export type RevisionDecision = { kind: "create" } | { kind: "unchanged" } | { kind: "revise" };

export function decideRevision<T>(latest: LatestRevision<T> | null, incoming: IncomingRevision<T>): RevisionDecision {
  if (latest === null) return { kind: "create" };
  const sameContent = canonicalJson(latest.payload) === canonicalJson(incoming.payload);
  return sameContent ? { kind: "unchanged" } : { kind: "revise" };
}

// Serialises a payload with sorted keys and sorted list fields, so two payloads that differ only in key order or in the
// order of countries and channels compare as equal. The content comparison uses this form, not the raw object.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonicalize).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}
