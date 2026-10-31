// Step-up guard (Blueprint §7, API-004). A privileged route passes only when the session's second factor is
// recent. Callers pass the timestamp; this function reads no storage and never reaches a route by itself.
export type AssuranceInput = {
  // When the session's second factor was verified, or null when none is recorded.
  secondFactorAt: Date | null;
  now: Date;
  windowSeconds: number;
};

export type AssuranceResult = { ok: true } | { ok: false; code: "STEP_UP_REQUIRED" };

export function requireRecentSecondFactor({ secondFactorAt, now, windowSeconds }: AssuranceInput): AssuranceResult {
  if (secondFactorAt === null) return { ok: false, code: "STEP_UP_REQUIRED" };
  const ageMs = now.getTime() - secondFactorAt.getTime();
  // A timestamp in the future cannot be verified, so it does not count as recent.
  if (ageMs < 0 || ageMs > windowSeconds * 1000) return { ok: false, code: "STEP_UP_REQUIRED" };
  return { ok: true };
}
