import type { AttributableClick, AttributionClickStore } from "@moneytrap/app/src/ports/attribution-click-store";

/** In-memory stand-in for the attribution click lookup. A sub ID maps to every click that carries it. */
export class FakeAttributionClickStore implements AttributionClickStore {
  private readonly bySubId = new Map<string, AttributableClick[]>();

  /** Seeds one click under a sub ID, as the redirect records it. */
  addClick(subId: string, click: AttributableClick): void {
    const clicks = this.bySubId.get(subId) ?? [];
    clicks.push({ ...click });
    this.bySubId.set(subId, clicks);
  }

  async clicksWithSubId(subId: string): Promise<AttributableClick[]> {
    return (this.bySubId.get(subId) ?? []).map((click) => ({ ...click }));
  }
}
