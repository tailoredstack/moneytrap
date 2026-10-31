import type { ClickCountQuery, ClickCountRow, ClickReportStore } from "@moneytrap/app/src/ports/click-report-store";
import type { Id } from "@moneytrap/domain";

interface SeededClick {
  linkId: string;
  occurredAt: Date;
  recordedAt: Date;
}

// In-memory stand-in for the click report store. It applies the same rules as the Postgres query: clicks count only for
// links of the queried organization, the window is half-open, and pages run in link ID order.
export class FakeClickReportStore implements ClickReportStore {
  private readonly owners = new Map<string, string>();
  private readonly clicks: SeededClick[] = [];

  seedLink(linkId: string, organizationId: Id<"organization">): void {
    this.owners.set(linkId, organizationId);
  }

  seedClick(linkId: string, occurredAt: Date, recordedAt: Date = occurredAt): void {
    this.clicks.push({ linkId, occurredAt, recordedAt });
  }

  async countByLink(query: ClickCountQuery): Promise<readonly ClickCountRow[]> {
    const counts = new Map<string, number>();
    for (const click of this.clicks) {
      if (this.owners.get(click.linkId) !== query.organizationId) continue;
      if (click.occurredAt < query.from || click.occurredAt >= query.to) continue;
      counts.set(click.linkId, (counts.get(click.linkId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([linkId]) => query.afterLinkId === null || linkId > query.afterLinkId)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, query.limit)
      .map(([linkId, clicks]) => ({ linkId, clicks }));
  }

  async recordedDelayMs(organizationId: Id<"organization">, since: Date): Promise<number | null> {
    const delays = this.clicks
      .filter((click) => this.owners.get(click.linkId) === organizationId && click.recordedAt >= since)
      .map((click) => click.recordedAt.getTime() - click.occurredAt.getTime());
    return delays.length === 0 ? null : Math.max(...delays);
  }
}
