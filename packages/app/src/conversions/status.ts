import {
  CONVERSION_STATES,
  type ConversionState,
  type CurrencyCode,
  checkAdjustment,
  checkTransition,
  type ErrorCode,
  type Id,
} from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { ConversionStatusStore } from "../ports/conversion-status-store";

export interface RecordStatusInput {
  conversionId: Id<"conversion">;
  // The network's own ID for the status report. Together with the conversion it makes a report idempotent (DM-034).
  sourceEventKey: string;
  toState: ConversionState;
  sourceAt: Date;
}

export type StatusOutcome = "recorded" | "duplicate" | "unchanged";

export type StatusResult =
  | { ok: true; value: { outcome: StatusOutcome; state: ConversionState } }
  | { ok: false; code: ErrorCode; reason: string };

// Records a network status report as an event. The event is the only record of the move. A repeated report writes nothing
// (replay), and a repeated state writes nothing (unchanged). An illegal move is refused with STATE_CONFLICT (TP-W6-018).
export async function recordConversionStatus(
  ctx: Ctx,
  store: ConversionStatusStore,
  input: RecordStatusInput,
): Promise<StatusResult> {
  if (input.sourceEventKey.trim() === "") {
    return { ok: false, code: "VALIDATION_FAILED", reason: "sourceEventKey is required" };
  }
  if (!CONVERSION_STATES.includes(input.toState)) {
    return { ok: false, code: "VALIDATION_FAILED", reason: `unknown state ${input.toState}` };
  }
  if (Number.isNaN(input.sourceAt.getTime())) {
    return { ok: false, code: "VALIDATION_FAILED", reason: "sourceAt must be a valid instant" };
  }

  const conversion = await store.findConversion(input.conversionId);
  if (!conversion) return { ok: false, code: "RESOURCE_NOT_FOUND", reason: "conversion not found" };

  // A key already stored is a replay, whatever the state is now. Checking it first keeps a late replay from looking illegal.
  if (await store.hasStatusEvent(input.conversionId, input.sourceEventKey)) {
    return { ok: true, value: { outcome: "duplicate", state: conversion.state ?? input.toState } };
  }

  const check = checkTransition(conversion.state, input.toState);
  if (!check.ok) return check;
  if (check.kind === "unchanged") {
    return { ok: true, value: { outcome: "unchanged", state: input.toState } };
  }

  const outcome = await store.appendStatusEvent({
    id: ctx.ids.next("conversionStatusEvent"),
    conversionId: input.conversionId,
    sourceEventKey: input.sourceEventKey,
    fromState: conversion.state,
    toState: input.toState,
    sourceAt: input.sourceAt,
    receivedAt: ctx.clock.now(),
  });
  if (outcome === "stale") {
    return { ok: false, code: "STATE_CONFLICT", reason: "another status event was recorded first" };
  }
  if (outcome === "duplicate") {
    return { ok: true, value: { outcome: "duplicate", state: conversion.state ?? input.toState } };
  }
  return { ok: true, value: { outcome: "recorded", state: input.toState } };
}

export interface RecordAdjustmentInput {
  conversionId: Id<"conversion">;
  externalAdjustmentId: string;
  deltaMinor: bigint;
  currency: CurrencyCode;
  reason: string | null;
  reportedAt: Date;
}

export type AdjustmentResult =
  | { ok: true; value: { outcome: "recorded" | "duplicate" } }
  | { ok: false; code: ErrorCode; reason: string };

// Stores a network adjustment as a new row. An adjustment is never edited. The same ID reported with new content is a
// conflict, not an update (DM-035).
export async function recordConversionAdjustment(
  ctx: Ctx,
  store: ConversionStatusStore,
  input: RecordAdjustmentInput,
): Promise<AdjustmentResult> {
  const conversion = await store.findConversion(input.conversionId);
  if (!conversion) return { ok: false, code: "RESOURCE_NOT_FOUND", reason: "conversion not found" };

  const check = checkAdjustment(conversion.currency, input);
  if (!check.ok) return check;

  const outcome = await store.appendAdjustment({
    id: ctx.ids.next("conversionAdjustment"),
    conversionId: input.conversionId,
    externalAdjustmentId: input.externalAdjustmentId,
    deltaMinor: input.deltaMinor,
    currency: input.currency,
    reason: input.reason,
    reportedAt: input.reportedAt,
    receivedAt: ctx.clock.now(),
  });
  if (outcome === "conflict") {
    return { ok: false, code: "STATE_CONFLICT", reason: "adjustment ID already stored with different content" };
  }
  return { ok: true, value: { outcome } };
}
