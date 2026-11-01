import {
  type CurrencyCode,
  can,
  type ErrorCode,
  evaluatePayout,
  type Id,
  isCurrencyCode,
  type PayoutExclusion,
  type Permission,
  type Principal,
  parseId,
  policyInEffect,
  type Scope,
} from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import { publisherBalances } from "../finance/balances";
import type { BatchSkipReason, PayoutBatchRecord, PayoutBatchStore, ReserveLine } from "../ports/payout-batch-store";
import type { PayoutHoldStore } from "../ports/payout-hold-store";
import type { PayoutPolicyStore } from "../ports/payout-policy-store";
import type { PublisherBalanceSource } from "../ports/publisher-balance-source";

export interface PayoutBatchLineView {
  payoutId: Id<"payout">;
  publisherId: Id<"publisher">;
  methodId: Id<"payoutMethod">;
  amountMinor: bigint;
  state: string;
}

export interface PayoutBatchView {
  id: Id<"payoutBatch">;
  currency: CurrencyCode;
  periodStart: Date;
  periodEnd: Date;
  state: string;
  capMinor: bigint | null;
  policyVersion: number;
  createdBy: Id<"user">;
  createdAt: Date;
  // The sum of the lines that still hold funds. Currencies are never summed together; a batch has one.
  totalMinor: bigint;
  lines: PayoutBatchLineView[];
}

// A publisher the batch left out, with why, so a finance user can see the reason (TP-W7-010).
export interface ExcludedPublisher {
  publisherId: Id<"publisher">;
  reasons: (PayoutExclusion | BatchSkipReason)[];
}

type Failure = { ok: false; code: ErrorCode; reason?: string };

export type PrepareBatchResult =
  | {
      ok: true;
      // `replayed` is true when the reservation key had already made this batch. Nothing new was reserved.
      value: { batch: PayoutBatchView; replayed: boolean; excluded: ExcludedPublisher[] };
    }
  | Failure;
export type CancelBatchResult = { ok: true; value: { id: Id<"payoutBatch">; state: "cancelled" } } | Failure;

export interface PayoutBatchDeps {
  batches: PayoutBatchStore;
  balances: PublisherBalanceSource;
  policies: PayoutPolicyStore;
  holds: PayoutHoldStore;
}

// The only fields a preparation accepts. Anything else is refused before any value is read.
const PREPARE_FIELDS = ["currency", "period_start", "period_end", "reservation_key", "cap_minor"] as const;
const RESERVATION_KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const MINOR_RE = /^[1-9][0-9]{0,17}$/;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

type ParsedPreparation =
  | {
      ok: true;
      currency: CurrencyCode;
      periodStart: Date;
      periodEnd: Date;
      reservationKey: string;
      capMinor: bigint | null;
    }
  | { ok: false; reason: string };

function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_INSTANT_RE.test(value)) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

function parsePreparation(body: unknown): ParsedPreparation {
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (raw === null) return { ok: false, reason: "body must be an object" };
  const unexpected = Object.keys(raw).find((key) => !(PREPARE_FIELDS as readonly string[]).includes(key));
  if (unexpected !== undefined) return { ok: false, reason: `${unexpected} is not an accepted field` };

  const { currency, reservation_key: reservationKey, cap_minor: cap } = raw;
  if (typeof currency !== "string" || !isCurrencyCode(currency)) return { ok: false, reason: "currency is invalid" };
  const periodStart = parseInstant(raw.period_start);
  if (periodStart === null) return { ok: false, reason: "period_start must be an ISO-8601 UTC instant" };
  const periodEnd = parseInstant(raw.period_end);
  if (periodEnd === null) return { ok: false, reason: "period_end must be an ISO-8601 UTC instant" };
  if (periodEnd.getTime() <= periodStart.getTime()) return { ok: false, reason: "period_end must follow period_start" };
  if (typeof reservationKey !== "string" || !RESERVATION_KEY_RE.test(reservationKey)) {
    return { ok: false, reason: "reservation_key is invalid" };
  }
  // The cap is a string of minor units, so it never passes through a float.
  if (cap !== undefined && (typeof cap !== "string" || !MINOR_RE.test(cap))) {
    return { ok: false, reason: "cap_minor must be a positive integer string of minor units" };
  }
  return {
    ok: true,
    currency,
    periodStart,
    periodEnd,
    reservationKey,
    capMinor: cap === undefined ? null : BigInt(cap as string),
  };
}

// Grants come only from membership in the scope. The actor must be the principal, so one user cannot act as another.
function authorize(ctx: Ctx, principal: Principal, scope: Scope, permission: Permission): Failure | null {
  if (ctx.actor.type !== "user" || ctx.actor.id !== principal.userId) return { ok: false, code: "UNAUTHENTICATED" };
  if (!can(principal, permission, scope)) return { ok: false, code: "FORBIDDEN" };
  return null;
}

export function toBatchView(record: PayoutBatchRecord): PayoutBatchView {
  return {
    id: record.id,
    currency: record.currency,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    state: record.state,
    capMinor: record.capMinor,
    policyVersion: record.policyVersion,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    totalMinor: record.lines.reduce((sum, line) => (line.state === "reserved" ? sum + line.amountMinor : sum), 0n),
    lines: record.lines.map((line) => ({
      payoutId: line.id,
      publisherId: line.publisherId,
      methodId: line.methodId,
      amountMinor: line.amountMinor,
      state: line.state,
    })),
  };
}

// Prepares a batch and reserves its funds (DM-047, DM-048, CT-022). Each publisher with an active method is paid what the
// policy allows from its cleared balance, less holds and minimums. The store then reserves under a lock, so batches over the
// same funds cannot reserve more than is available in total (TP-W7-012). The reservation key makes a re-run return the batch
// it already made instead of reserving again (TP-W7-013). The balance read here is a snapshot: the approval step checks
// available again before money moves (TP-W7-014, WP-7.8).
// The period labels the batch for reporting and keys a re-run; it does not select funds. A publisher is paid everything
// cleared and unreserved, whichever period it cleared in, so an amount left over from an earlier period is never stranded.
export async function prepareBatch(
  ctx: Ctx,
  deps: PayoutBatchDeps,
  principal: Principal,
  scope: Scope,
  body: unknown,
): Promise<PrepareBatchResult> {
  const denied = authorize(ctx, principal, scope, "payouts:write");
  if (denied) return denied;

  const parsed = parsePreparation(body);
  if (!parsed.ok) return { ok: false, code: "VALIDATION_FAILED", reason: parsed.reason };

  const now = ctx.clock.now();
  const policy = policyInEffect(await deps.policies.list(parsed.currency), parsed.currency, now);
  if (policy === null) return { ok: false, code: "STATE_CONFLICT", reason: "no payout policy in effect" };

  const candidates = await deps.batches.listCandidates(scope.organizationId, parsed.currency);
  const lines: ReserveLine[] = [];
  const excluded: ExcludedPublisher[] = [];
  for (const candidate of candidates) {
    const view = await publisherBalances(ctx, deps.balances, { publisherId: candidate.publisherId });
    const availableMinor = view.balances.find((balance) => balance.currency === parsed.currency)?.availableMinor ?? 0n;
    const holds = await deps.holds.listForPublisher(scope.organizationId, candidate.publisherId, parsed.currency);
    const decision = evaluatePayout({
      policy,
      publisherId: candidate.publisherId,
      availableMinor,
      holds,
      at: now,
    });
    if (!decision.eligible) {
      excluded.push({ publisherId: candidate.publisherId, reasons: decision.exclusions });
      continue;
    }
    lines.push({
      payoutId: ctx.ids.next("payout"),
      publisherId: candidate.publisherId,
      methodId: candidate.methodId,
      requestedMinor: decision.payableMinor,
      availableMinor,
      minimumMinor: policy.minimumMinor,
    });
  }

  const outcome = await deps.batches.reserve({
    organizationId: scope.organizationId,
    batchId: ctx.ids.next("payoutBatch"),
    reservationKey: parsed.reservationKey,
    currency: parsed.currency,
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    capMinor: parsed.capMinor,
    policyVersion: policy.version,
    createdBy: principal.userId,
    createdAt: now,
    lines,
    audit: { id: ctx.ids.next("audit"), actor: { type: "user", id: principal.userId }, occurredAt: now },
  });

  switch (outcome.outcome) {
    case "key_conflict":
      return { ok: false, code: "STATE_CONFLICT", reason: "reservation_key was used for a different batch" };
    case "key_cancelled":
      return {
        ok: false,
        code: "STATE_CONFLICT",
        reason: "reservation_key belongs to a cancelled batch; use a new key",
      };
    case "nothing_reserved":
      return {
        ok: false,
        code: "STATE_CONFLICT",
        reason: "nothing to reserve: no publisher has funds available for payout",
      };
    case "replayed":
      return { ok: true, value: { batch: toBatchView(outcome.batch), replayed: true, excluded: [] } };
    case "reserved":
      return {
        ok: true,
        value: {
          batch: toBatchView(outcome.batch),
          replayed: false,
          excluded: [
            ...excluded,
            ...outcome.skipped.map((skip) => ({ publisherId: skip.publisherId, reasons: [skip.reason] })),
          ],
        },
      };
  }
}

// Cancelling frees every reservation in the batch. A batch that is already cancelled is returned as cancelled and nothing is
// written, and a batch of another organization is not found.
export async function cancelBatch(
  ctx: Ctx,
  deps: Pick<PayoutBatchDeps, "batches">,
  principal: Principal,
  scope: Scope,
  id: string,
): Promise<CancelBatchResult> {
  const denied = authorize(ctx, principal, scope, "payouts:write");
  if (denied) return denied;
  const batchId = parseId("payoutBatch", id);
  if (batchId === null) return { ok: false, code: "RESOURCE_NOT_FOUND" };

  const at = ctx.clock.now();
  const outcome = await deps.batches.cancel({
    organizationId: scope.organizationId,
    batchId,
    at,
    audit: { id: ctx.ids.next("audit"), actor: { type: "user", id: principal.userId }, occurredAt: at },
  });
  if (outcome === "not_found") return { ok: false, code: "RESOURCE_NOT_FOUND" };
  return { ok: true, value: { id: batchId, state: "cancelled" } };
}
