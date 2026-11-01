import type { StatementRecord, StatementStore } from "@moneytrap/app/src/ports/statement-store";
import type { Kysely } from "kysely";
import { sql } from "kysely";

type Stored = {
  id: string;
  publisher_id: string;
  currency: string;
  period_start: Date;
  period_end: Date;
  revision: number;
  content_hash: string;
  object_ref: string;
  content: StatementRecord["content"];
  created_at: Date;
};

export function createStatementStore(
  db: Kysely<unknown>,
  options: { signDownloadUrl?: (objectRef: string) => Promise<string> } = {},
): StatementStore {
  const decode = (row: Stored): StatementRecord => ({
    id: row.id as StatementRecord["id"],
    publisherId: row.publisher_id as StatementRecord["publisherId"],
    currency: row.currency as StatementRecord["currency"],
    periodStart: new Date(row.period_start),
    periodEnd: new Date(row.period_end),
    revision: row.revision,
    contentHash: row.content_hash,
    objectRef: row.object_ref,
    content: row.content,
    createdAt: new Date(row.created_at),
  });
  return {
    async listForOrganization(userId, organizationId) {
      if (!userId) return [];
      const { rows } = await sql<Stored>`select s.* from statements s join publishers p on p.id = s.publisher_id
        join memberships m on m.organization_id = p.organization_id where m.user_id = ${userId} and p.organization_id = ${organizationId}
        order by s.period_start desc, s.revision asc`.execute(db);
      return rows.map(decode);
    },
    async findForOrganization(userId, organizationId, statementId) {
      if (!userId) return null;
      const { rows } = await sql<Stored>`select s.* from statements s join publishers p on p.id = s.publisher_id
        join memberships m on m.organization_id = p.organization_id where m.user_id = ${userId}
        and p.organization_id = ${organizationId} and s.id = ${statementId}`.execute(db);
      return rows[0] ? decode(rows[0]) : null;
    },
    async downloadUrl(objectRef) {
      if (!options.signDownloadUrl) throw new Error("statement download URL signer is not configured");
      return options.signDownloadUrl(objectRef);
    },
    async findClosed(publisherId, currency, periodStart, periodEnd) {
      const { rows } =
        await sql<Stored>`select * from statements where publisher_id = ${publisherId} and currency = ${currency}
        and period_start = ${periodStart} and period_end = ${periodEnd} order by revision asc limit 1`.execute(db);
      return rows[0] ? decode(rows[0]) : null;
    },
    async recordClosed(record) {
      const { rows } = await sql<{ id: string }>`insert into statements
        (id, publisher_id, currency, period_start, period_end, revision, totals, content, content_hash, object_ref, created_at)
        values (${record.id}, ${record.publisherId}, ${record.currency}, ${record.periodStart}, ${record.periodEnd}, ${record.revision},
        ${JSON.stringify(record.content.totals)}::jsonb, ${JSON.stringify(record.content)}::jsonb, ${record.contentHash}, ${record.objectRef}, ${record.createdAt})
        on conflict (publisher_id, currency, period_start, period_end) do nothing returning id`.execute(db);
      return rows.length > 0;
    },
    async list(publisherId) {
      const { rows } =
        await sql<Stored>`select * from statements where publisher_id = ${publisherId} order by period_start desc, revision asc`.execute(
          db,
        );
      return rows.map(decode);
    },
  };
}
