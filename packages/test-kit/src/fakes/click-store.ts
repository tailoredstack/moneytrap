import type { ClickObservation, ClickRecordOutcome, ClickStore } from "@moneytrap/app/src/ports/click-store";

// In-memory stand-in for the click store. Keeps one fact per dedup key, as the Postgres primary key does.
export class FakeClickStore implements ClickStore {
  private readonly facts = new Map<string, ClickObservation>();

  async record(click: ClickObservation): Promise<ClickRecordOutcome> {
    if (this.facts.has(click.dedupKey)) return "duplicate";
    this.facts.set(click.dedupKey, { ...click });
    return "recorded";
  }

  recorded(): readonly ClickObservation[] {
    return [...this.facts.values()].map((click) => ({ ...click }));
  }
}
