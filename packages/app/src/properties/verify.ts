import {
  can,
  challengeExpiresAt,
  type ErrorCode,
  type Id,
  isChallengeExpired,
  markPropertyVerified,
  POST_VERIFICATION_STATUSES,
  type Principal,
  type PropertyStatus,
  requestPropertyVerification,
  type Scope,
  VERIFICATION_TXT_PREFIX,
  verificationRecordName,
} from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { DnsResolver } from "../ports/dns-resolver";
import type { PropertyStore, VerificationChallenge } from "../ports/property-store";
import type { VerificationTokens } from "../ports/verification-tokens";

export interface VerificationDeps {
  store: PropertyStore;
  dns: DnsResolver;
  tokens: VerificationTokens;
}

type Failure = { ok: false; code: ErrorCode; reason?: string };

export type ChallengeResult =
  | { ok: true; value: { challengeText: string; recordName: string; expiresAt: Date } }
  | Failure;

export type VerifyResult =
  | { ok: true; value: { verificationStatus: "verified" | "verification_pending"; changed: boolean } }
  | Failure;

// The caller passes the principal and the scope it targets. Grants come from membership in that scope only.
// The store also filters by scope, so a property in another tenant reads as not found.
function authorize(ctx: Ctx, principal: Principal, scope: Scope): Failure | null {
  if (ctx.actor.type !== "user" || ctx.actor.id !== principal.userId) return { ok: false, code: "UNAUTHENTICATED" };
  if (!can(principal, "properties:write", scope)) return { ok: false, code: "FORBIDDEN" };
  return null;
}

const NOT_FOUND: Failure = { ok: false, code: "RESOURCE_NOT_FOUND" };
const CONFLICT: Failure = { ok: false, code: "STATE_CONFLICT" };

// Issues a DNS TXT challenge (API-027). The token is returned once and only its digest is stored.
// Requesting again replaces the challenge; the previous token stops counting.
export async function requestPropertyChallenge(
  ctx: Ctx,
  deps: VerificationDeps,
  input: { principal: Principal; scope: Scope; propertyId: Id<"property">; method: unknown },
): Promise<ChallengeResult> {
  const denied = authorize(ctx, input.principal, input.scope);
  if (denied) return denied;
  if (input.method !== "dns") {
    return { ok: false, code: "VALIDATION_FAILED", reason: "only the dns method is supported" };
  }

  const property = await deps.store.find(input.scope, input.propertyId);
  if (!property) return NOT_FOUND;
  // A draft moves to verification pending. A pending property stays pending, with a new challenge.
  // Anything past verification has nothing left to prove, so it is a conflict.
  const transition =
    property.status === "draft"
      ? requestPropertyVerification(property)
      : property.status === "verification_pending"
        ? { ok: true as const, value: property }
        : CONFLICT;
  if (!transition.ok) return { ok: false, code: transition.code };

  const now = ctx.clock.now();
  const token = deps.tokens.issue();
  const expiresAt = challengeExpiresAt(now);
  const challenge: VerificationChallenge = {
    id: ctx.ids.next("verification"),
    propertyId: property.id,
    method: "dns",
    challengeHash: deps.tokens.digest(token),
    expiresAt,
    verifiedAt: null,
    attempts: 0,
    createdAt: now,
  };
  const written = await deps.store.issueChallenge({
    property,
    nextStatus: transition.value.status,
    challenge,
    audit: {
      id: ctx.ids.next("event"),
      organizationId: property.organizationId,
      actor: ctx.actor,
      action: "property.verification_challenged",
      entityType: "property",
      entityId: property.id,
      metadata: { method: "dns", expiresAt: expiresAt.toISOString() },
      occurredAt: now,
    },
    event: {
      id: ctx.ids.next("event"),
      topic: "property.verification_challenged",
      aggregateId: property.id,
      aggregateVersion: property.version + 1,
      payload: { propertyId: property.id, method: "dns", expiresAt: expiresAt.toISOString() },
    },
  });
  // The version moved under us, so another request or verify won. Nothing was written and the caller retries.
  if (!written) return CONFLICT;

  return {
    ok: true,
    value: {
      challengeText: `${VERIFICATION_TXT_PREFIX}${token}`,
      recordName: verificationRecordName(property.normalizedIdentifier),
      expiresAt,
    },
  };
}

// Checks the DNS TXT record for the latest challenge (API-028). A verified property returns the same answer again, so
// rechecks are idempotent: only the first successful check writes a state change, event and audit row.
export async function verifyProperty(
  ctx: Ctx,
  deps: VerificationDeps,
  input: { principal: Principal; scope: Scope; propertyId: Id<"property">; challengeId?: Id<"verification"> },
): Promise<VerifyResult> {
  const denied = authorize(ctx, input.principal, input.scope);
  if (denied) return denied;

  const property = await deps.store.find(input.scope, input.propertyId);
  if (!property) return NOT_FOUND;
  if (isVerifiedOrBeyond(property.status)) {
    return { ok: true, value: { verificationStatus: "verified", changed: false } };
  }
  if (property.status !== "verification_pending") return CONFLICT;

  const challenge = await deps.store.latestChallenge(property.id);
  if (!challenge) return CONFLICT;
  if (input.challengeId !== undefined && input.challengeId !== challenge.id) return CONFLICT;

  const now = ctx.clock.now();
  if (isChallengeExpired(challenge.expiresAt, now)) return { ok: false, code: "TOKEN_EXPIRED" };

  // Count the attempt before the lookup, so a lookup that fails still shows up in the attempt count.
  await deps.store.recordAttempt(challenge.id);
  const recordName = verificationRecordName(property.normalizedIdentifier);
  let records: string[];
  try {
    records = await deps.dns.resolveTxt(recordName);
  } catch {
    return { ok: false, code: "PROVIDER_UNAVAILABLE" };
  }
  if (!records.some((record) => matchesChallenge(record, challenge, deps.tokens))) {
    return { ok: true, value: { verificationStatus: "verification_pending", changed: false } };
  }
  // The lookup can outlive the challenge. Check a fresh time, so a late match cannot verify an expired challenge.
  const completedAt = ctx.clock.now();
  if (isChallengeExpired(challenge.expiresAt, completedAt)) return { ok: false, code: "TOKEN_EXPIRED" };

  const transition = markPropertyVerified(property);
  if (!transition.ok) return CONFLICT;
  const written = await deps.store.completeVerification({
    property,
    nextStatus: transition.value.status,
    challengeId: challenge.id,
    verifiedAt: completedAt,
    audit: {
      id: ctx.ids.next("event"),
      organizationId: property.organizationId,
      actor: ctx.actor,
      action: "property.verified",
      entityType: "property",
      entityId: property.id,
      metadata: { method: "dns" },
      occurredAt: completedAt,
    },
    event: {
      id: ctx.ids.next("event"),
      topic: "property.verified",
      aggregateId: property.id,
      aggregateVersion: property.version + 1,
      payload: { propertyId: property.id, method: "dns" },
    },
  });
  if (written) return { ok: true, value: { verificationStatus: "verified", changed: true } };

  // Another verify won the race. Its change already committed, so this call is a repeat, not a failure.
  const latest = await deps.store.find(input.scope, property.id);
  if (latest && isVerifiedOrBeyond(latest.status)) {
    return { ok: true, value: { verificationStatus: "verified", changed: false } };
  }
  return CONFLICT;
}

// Verification is a fact about ownership. Once it holds, later review states do not undo it.
function isVerifiedOrBeyond(status: PropertyStatus): boolean {
  return POST_VERIFICATION_STATUSES.includes(status);
}

function matchesChallenge(record: string, challenge: VerificationChallenge, tokens: VerificationTokens): boolean {
  const value = record.trim();
  if (!value.startsWith(VERIFICATION_TXT_PREFIX)) return false;
  return tokens.digest(value.slice(VERIFICATION_TXT_PREFIX.length)) === challenge.challengeHash;
}
