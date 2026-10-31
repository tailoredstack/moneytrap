import type { ClickCountRow, ClickReportStore } from "@moneytrap/app/src/ports/click-report-store";
import { type Kysely, sql } from "kysely";

// Reads only. Every query joins clicks to links and filters by the links' organization, so a click of another tenant
// never counts (WP-5.9). The window query has no index on occurred_at alone, so its scan is bounded by the links of the
// organization; clicks_link_occurred_idx serves the join when the link filter is selective.
export function createClickReportStore(db: Kysely<unknown>): ClickReportStore {
  return {
    async countByLink(query): Promise<readonly ClickCountRow[]> {
      const result = await sql<{ link_id: string; clicks: number }>`
        select l.id as link_id, count(c.dedup_key)::int as clicks
        from clicks c
        join links l on l.id = c.link_id
        where l.organization_id = ${query.organizationId}
          and c.occurred_at >= ${query.from}
          and c.occurred_at < ${query.to}
          and (${query.afterLinkId}::text is null or l.id > ${query.afterLinkId})
        group by l.id
        order by l.id
        limit ${query.limit}`.execute(db);
      return result.rows.map((row) => ({ linkId: row.link_id, clicks: row.clicks }));
    },

    // Looks back at most lookbackDays, the widest window a report can ask for, so the freshness check does not read the
    // organization's whole history on every page.
    async latestRecordedAt(organizationId, lookback): Promise<Date | null> {
      const result = await sql<{ latest: Date | null }>`
        select max(c.recorded_at) as latest
        from clicks c
        join links l on l.id = c.link_id
        where l.organization_id = ${organizationId}
          and c.recorded_at >= ${lookback}`.execute(db);
      return result.rows[0]?.latest ?? null;
    },
  };
}
