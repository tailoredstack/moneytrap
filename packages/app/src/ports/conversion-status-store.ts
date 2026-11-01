import type { ConversionAdjustmentInput, ConversionState, CurrencyCode, Id } from "@moneytrap/domain";

export interface StoredConversion {
  currency: CurrencyCode;
  // The state of the latest status event, or null when no event exists yet.
  state: ConversionState | null;
}

export interface AppendStatusEventInput {
  id: Id<"conversionStatusEvent">;
  conversionId: Id<"conversion">;
  sourceEventKey: string;
  fromState: ConversionState | null;
  toState: ConversionState;
  sourceAt: Date;
  receivedAt: Date;
}

// recorded: a new event row. duplicate: the same source event was already stored, so nothing was written. stale: the latest
// state no longer matches fromState, because another event landed first.
export type AppendStatusEventOutcome = "recorded" | "duplicate" | "stale";

export interface AppendAdjustmentInput extends ConversionAdjustmentInput {
  id: Id<"conversionAdjustment">;
  conversionId: Id<"conversion">;
  receivedAt: Date;
}

// recorded: a new adjustment row. duplicate: the same adjustment with the same content was stored. conflict: the same
// external ID was stored with different content. An adjustment is never updated in place.
export type AppendAdjustmentOutcome = "recorded" | "duplicate" | "conflict";

// Status events and adjustments are append-only. The adapter runs each append atomically, so two writers cannot both
// record the same transition.
export interface ConversionStatusStore {
  findConversion(id: Id<"conversion">): Promise<StoredConversion | null>;
  hasStatusEvent(conversionId: Id<"conversion">, sourceEventKey: string): Promise<boolean>;
  appendStatusEvent(input: AppendStatusEventInput): Promise<AppendStatusEventOutcome>;
  appendAdjustment(input: AppendAdjustmentInput): Promise<AppendAdjustmentOutcome>;
}
