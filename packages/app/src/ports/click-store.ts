// One observed click. The dedup key names the logical click, not the delivery attempt (CT-013): the redirect derives it
// from the click attempt, so a redelivered event carries the same key and a distinct click carries a different one.
export interface ClickObservation {
  dedupKey: string;
  linkId: string;
  occurredAt: Date;
}

// `recorded` means a new click fact was written. `duplicate` means a fact with this dedup key already exists, and nothing
// was written.
export type ClickRecordOutcome = "recorded" | "duplicate";

export interface ClickStore {
  record(click: ClickObservation): Promise<ClickRecordOutcome>;
}
