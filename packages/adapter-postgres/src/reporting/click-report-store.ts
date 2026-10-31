import type { ClickCountRow, ClickReportStore } from "@moneytrap/app/src/ports/click-report-store";
import { type Kysely, sql } from "kysely";

// Reads only. Every query joins clicks to links and filters by the links' organization, so a click of another tenant
// never counts (WP-5.9). The clicks_link_occurred_idx index covers the window, and the links primary key covers the join.
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

    async latestRecordedAt(organizationId): Promise<Date | null> {
      const result = await sql<{ latest: Date | null }>`
        select max(c.recorded_at) as latest
        from clicks c
        join links l on l.id = c.link_id
        where l.organization_id = ${organizationId}`.execute(db);
      return result.rows[0]?.latest ?? null;
    },
  };
}
