import type {
  ClickBurst,
  RiskFlagStore,
  RiskFlagWrite,
  RiskFlagWriteOutcome,
} from "@moneytrap/app/src/ports/risk-flag-store";
import { type Kysely, sql } from "kysely";

// Reads click bursts from the click facts and writes flags (DM-060, WP-5.10). Nothing here writes to clicks or links.
export function createRiskFlagStore(db: Kysely<unknown>): RiskFlagStore {
  return {
    async findClickBursts(since: Date): Promise<ClickBurst[]> {
      const { rows } = await sql<{ link_id: string; occurred_at: Date; dedup_keys: string[] }>`
        select link_id, occurred_at, array_agg(dedup_key order by dedup_key) as dedup_keys
        from clicks
        where occurred_at >= ${since}
        group by link_id, occurred_at
        having count(*) > 1
        order by link_id, occurred_at`.execute(db);
      return rows.map((row) => ({ linkId: row.link_id, occurredAt: row.occurred_at, dedupKeys: row.dedup_keys }));
    },

    async raise(flag: RiskFlagWrite): Promise<RiskFlagWriteOutcome> {
      const { rows } = await sql<{ id: string }>`insert into risk_flags
          (link_id, rule_code, subject_key, severity, policy_version, evidence)
        values (${flag.linkId}, ${flag.ruleCode}, ${flag.subjectKey}, ${flag.severity}, ${flag.policyVersion},
          ${JSON.stringify(flag.evidence)}::jsonb)
        on conflict (rule_code, link_id, subject_key) do nothing
        returning id`.execute(db);
      return rows.length === 0 ? "existing" : "raised";
    },
  };
}
