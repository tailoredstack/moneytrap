import type { RouteSource, RouteSourceRecord } from "@moneytrap/app/src/ports/route-source";
import type { Id, LinkStatus } from "@moneytrap/domain";
import { type Kysely, sql } from "kysely";

interface RouteRow {
  id: string;
  publisher_id: string;
  property_id: string;
  slug: string;
  destination_url: string;
  status: LinkStatus;
  version: number;
  property_status: string | null;
  decision: string | null;
  allowed_hosts: unknown;
}

// The redirect's source of truth (ADR-007). It reads the Postgres primary, never a replica, so the read is not older than
// its loadedAt. A link's token is its ID. Eligible is the same gate a monetized write passes: the property is approved and
// the latest eligibility evaluation for its pair allows the program. The allow-list is the program's latest revision, the
// same one a monetized write checks. The redirect re-checks the destination against it (WP-5.7).
export function createRouteSource(db: Kysely<unknown>): RouteSource {
  return {
    async findByToken(token) {
      const result =
        await sql<RouteRow>`select l.id, l.publisher_id, l.property_id, l.slug, l.destination_url, l.status,
          l.version, p.status as property_status,
          (select d.decision from eligibility_evaluations e
            join eligibility_decisions d on d.id = e.decision_id
            where e.organization_id = l.organization_id and e.property_id = l.property_id and e.program_id = l.program_id
            order by e.seq desc
            limit 1) as decision,
          (select r.payload->'allowedHosts' from program_revisions r
            where r.program_id = l.program_id
            order by r.revision_seq desc
            limit 1) as allowed_hosts
        from links l
        join properties p on p.id = l.property_id and p.organization_id = l.organization_id
        where l.id = ${token}`.execute(db);
      const row = result.rows[0];
      if (!row) return null;
      const record: RouteSourceRecord = {
        link: {
          id: row.id as Id<"link">,
          publisherId: row.publisher_id as Id<"publisher">,
          propertyId: row.property_id as Id<"property">,
          slug: row.slug,
          destinationUrl: row.destination_url,
          status: row.status,
          version: row.version,
        },
        eligible: row.property_status === "approved" && row.decision === "allow",
        allowedHosts: Array.isArray(row.allowed_hosts)
          ? row.allowed_hosts.filter((entry): entry is string => typeof entry === "string")
          : [],
      };
      return record;
    },
  };
}
