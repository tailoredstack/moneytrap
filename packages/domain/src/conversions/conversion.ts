import type { ErrorCode } from "../errors/codes";
import type { CurrencyCode } from "../money/iso4217";

// Conversion states from DM-033 and DM-034. The network reports each one; the platform records the moves between them.
export const CONVERSION_STATES = ["pending", "approved", "declined", "reversed"] as const;
export type ConversionState = (typeof CONVERSION_STATES)[number];

// The only moves the platform accepts. A state not listed for a source has no outgoing move.
const MOVES: Record<ConversionState, readonly ConversionState[]> = {
  pending: ["approved", "declined"],
  approved: ["reversed"],
  declined: [],
  reversed: [],
};

export type TransitionCheck =
  | { ok: true; kind: "create" | "move" | "unchanged" }
  | { ok: false; code: ErrorCode; reason: string };

// Decides what a reported state means for the current one. `null` means no status event exists yet, and the first event
// must be pending. A repeated state is `unchanged`, so the caller writes no event for it. Any move not listed in MOVES is
// a STATE_CONFLICT.
export function checkTransition(from: ConversionState | null, to: ConversionState): TransitionCheck {
  if (!CONVERSION_STATES.includes(to)) return { ok: false, code: "VALIDATION_FAILED", reason: `unknown state ${to}` };
  if (from === null) {
    return to === "pending"
      ? { ok: true, kind: "create" }
      : { ok: false, code: "STATE_CONFLICT", reason: `a conversion starts as pending, not ${to}` };
  }
  if (from === to) return { ok: true, kind: "unchanged" };
  if (MOVES[from].includes(to)) return { ok: true, kind: "move" };
  return { ok: false, code: "STATE_CONFLICT", reason: `cannot move a ${from} conversion to ${to}` };
}

export interface ConversionAdjustmentInput {
  // The network's own ID for the adjustment. Together with the conversion it identifies the row (DM-035).
  externalAdjustmentId: string;
  // Signed minor units. Negative for a clawback. Zero changes nothing, so it is rejected.
  deltaMinor: bigint;
  currency: CurrencyCode;
  reason: string | null;
  reportedAt: Date;
}

export type AdjustmentCheck = { ok: true } | { ok: false; code: ErrorCode; reason: string };

// Checks an adjustment before it is stored as a new row. Adjustments are never edited, so there is no update rule.
export function checkAdjustment(conversionCurrency: CurrencyCode, input: ConversionAdjustmentInput): AdjustmentCheck {
  if (input.externalAdjustmentId.trim() === "") {
    return { ok: false, code: "VALIDATION_FAILED", reason: "externalAdjustmentId is required" };
  }
  if (input.deltaMinor === 0n) return { ok: false, code: "VALIDATION_FAILED", reason: "delta must not be zero" };
  if (input.currency !== conversionCurrency) {
    return { ok: false, code: "VALIDATION_FAILED", reason: `adjustment must be in ${conversionCurrency}` };
  }
  return { ok: true };
}
