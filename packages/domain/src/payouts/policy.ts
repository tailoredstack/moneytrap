import type { CurrencyCode } from "../money/iso4217";

// Payout minimum and hold rules (DM-045, spec §4.5). Pure: no clock, no I/O. Each policy version is effective from a date,
// and a version is never edited. A change publishes a new version, so a payout decided under an earlier version keeps
// that version's minimum (TP-W7-011). Amounts are bigint minor units.

export interface PayoutPolicy {
  // 1-based, per currency. A version is recorded with each decision that used it.
  version: number;
  currency: CurrencyCode;
  minimumMinor: bigint;
  effectiveFrom: Date;
}

export interface PayoutHold {
  id: string;
  publisherId: string;
  currency: CurrencyCode;
  amountMinor: bigint;
  reason: string;
  expiresAt: Date | null;
  releasedAt: Date | null;
}

export type PayoutExclusion = "below_minimum" | "held";

export interface PayoutDecision {
  policyVersion: number;
  eligible: boolean;
  // The amount that may be paid. Zero whenever the publisher is excluded.
  payableMinor: bigint;
  exclusions: PayoutExclusion[];
  // The active holds that exclude the publisher, so the reason can be shown.
  holds: PayoutHold[];
}

export function createPayoutPolicy(input: PayoutPolicy): PayoutPolicy {
  if (!Number.isInteger(input.version) || input.version < 1)
    throw new RangeError("payout policy: version must be >= 1");
  if (typeof input.minimumMinor !== "bigint" || input.minimumMinor < 0n) {
    throw new RangeError("payout policy: minimum must be a non-negative bigint of minor units");
  }
  return { ...input };
}

// The version in effect for a currency at an instant is the one with the latest effective date at or before it. A later
// version never reaches back before its effective date, so the history of earlier instants stays as it was.
export function policyInEffect(
  policies: readonly PayoutPolicy[],
  currency: CurrencyCode,
  at: Date,
): PayoutPolicy | null {
  let found: PayoutPolicy | null = null;
  for (const policy of policies) {
    if (policy.currency !== currency || policy.effectiveFrom.getTime() > at.getTime()) continue;
    if (
      found === null ||
      policy.effectiveFrom.getTime() > found.effectiveFrom.getTime() ||
      (policy.effectiveFrom.getTime() === found.effectiveFrom.getTime() && policy.version > found.version)
    ) {
      found = policy;
    }
  }
  return found;
}

// A hold stops paying out until it is released or its expiry passes. Expiry is exclusive.
export function isHoldActive(hold: PayoutHold, at: Date): boolean {
  if (hold.releasedAt !== null) return false;
  return hold.expiresAt === null || hold.expiresAt.getTime() > at.getTime();
}

// A publisher is paid only when no hold in the policy's currency is active and the available balance reaches the minimum.
// Available is the cleared amount (WP-6.9); the minimum and holds decide only whether it is paid now, not what it is.
export function evaluatePayout(input: {
  policy: PayoutPolicy;
  availableMinor: bigint;
  holds: readonly PayoutHold[];
  at: Date;
}): PayoutDecision {
  const { policy, availableMinor, at } = input;
  const holds = input.holds.filter((hold) => hold.currency === policy.currency && isHoldActive(hold, at));

  const exclusions: PayoutExclusion[] = [];
  if (holds.length > 0) exclusions.push("held");
  if (availableMinor < policy.minimumMinor || availableMinor <= 0n) exclusions.push("below_minimum");

  const eligible = exclusions.length === 0;
  return {
    policyVersion: policy.version,
    eligible,
    payableMinor: eligible ? availableMinor : 0n,
    exclusions,
    holds,
  };
}
