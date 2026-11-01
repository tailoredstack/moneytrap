import type {
  AppendAdjustmentInput,
  AppendAdjustmentOutcome,
  AppendStatusEventInput,
  AppendStatusEventOutcome,
  ConversionStatusStore,
  StoredConversion,
} from "@moneytrap/app/src/ports/conversion-status-store";
import type { ConversionState, CurrencyCode, Id } from "@moneytrap/domain";

export interface StoredStatusEvent {
  conversionId: Id<"conversion">;
  sourceEventKey: string;
  fromState: ConversionState | null;
  toState: ConversionState;
  sourceAt: Date;
}

export interface StoredAdjustment {
  conversionId: Id<"conversion">;
  externalAdjustmentId: string;
  deltaMinor: bigint;
  currency: CurrencyCode;
  reason: string | null;
  reportedAt: Date;
}

/** In-memory reference adapter for the conversion status store. Each append is atomic, as the Postgres adapter's transactions are. */
export class FakeConversionStatusStore implements ConversionStatusStore {
  readonly events: StoredStatusEvent[] = [];
  readonly adjustments: StoredAdjustment[] = [];
  private readonly conversions = new Map<string, StoredConversion>();

  /** Seeds a conversion, as the conversion import and attribution steps would before any status arrives. */
  addConversion(id: Id<"conversion">, currency: CurrencyCode, state: ConversionState | null = null): void {
    this.conversions.set(id, { currency, state });
  }

  async findConversion(id: Id<"conversion">): Promise<StoredConversion | null> {
    const conversion = this.conversions.get(id);
    if (!conversion) return null;
    return { ...conversion, state: this.latestState(id) };
  }

  async hasStatusEvent(conversionId: Id<"conversion">, sourceEventKey: string): Promise<boolean> {
    return this.events.some((e) => e.conversionId === conversionId && e.sourceEventKey === sourceEventKey);
  }

  async appendStatusEvent(input: AppendStatusEventInput): Promise<AppendStatusEventOutcome> {
    if (await this.hasStatusEvent(input.conversionId, input.sourceEventKey)) return "duplicate";
    if (this.latestState(input.conversionId) !== input.fromState) return "stale";
    this.events.push({
      conversionId: input.conversionId,
      sourceEventKey: input.sourceEventKey,
      fromState: input.fromState,
      toState: input.toState,
      sourceAt: input.sourceAt,
    });
    return "recorded";
  }

  async appendAdjustment(input: AppendAdjustmentInput): Promise<AppendAdjustmentOutcome> {
    const stored = this.adjustments.find(
      (a) => a.conversionId === input.conversionId && a.externalAdjustmentId === input.externalAdjustmentId,
    );
    if (stored) {
      const same =
        stored.deltaMinor === input.deltaMinor &&
        stored.currency === input.currency &&
        stored.reason === input.reason &&
        stored.reportedAt.getTime() === input.reportedAt.getTime();
      return same ? "duplicate" : "conflict";
    }
    this.adjustments.push({
      conversionId: input.conversionId,
      externalAdjustmentId: input.externalAdjustmentId,
      deltaMinor: input.deltaMinor,
      currency: input.currency,
      reason: input.reason,
      reportedAt: input.reportedAt,
    });
    return "recorded";
  }

  // The state is the to_state of the newest event, so it is derived from history. A seeded state stands in for history
  // that predates the fake, and only applies until the first event lands.
  private latestState(conversionId: Id<"conversion">): ConversionState | null {
    const latest = this.events.filter((e) => e.conversionId === conversionId).at(-1);
    return latest ? latest.toState : (this.conversions.get(conversionId)?.state ?? null);
  }
}
