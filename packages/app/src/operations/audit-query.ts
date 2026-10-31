import type { Ctx } from "../ctx";

// Read-only query behind the audit viewer (UI-077). It reads audit_logs and never writes (Blueprint §3.0).
// The viewer shows review decisions only; the actions match the decision labels in the UI skeleton.
export const REVIEW_DECISION_ACTIONS = ["approve", "reject", "suspend", "reinstate"] as const;

const DEFAULT_LIMIT = 25;

export interface AuditLogRow {
  id: string;
  organization_id: string | null;
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  occurred_at: Date;
}

export interface AuditDatabase {
  audit_logs: AuditLogRow;
}

export interface ReviewDecisionEntry {
  id: string;
  actor: { type: string; id: string | null };
  scope: string | null;
  action: string;
  reason: string | null;
  occurredAt: string;
  object: { type: string; id: string };
}

// The reason is written into metadata by the decision action (WP-3.3). A missing reason is shown as null, not invented.
export function toReviewDecisionEntry(row: AuditLogRow): ReviewDecisionEntry {
  const reason = row.metadata.reason;
  return {
    id: row.id,
    actor: { type: row.actor_type, id: row.actor_id },
    scope: row.organization_id,
    action: row.action,
    reason: typeof reason === "string" ? reason : null,
    occurredAt: row.occurred_at.toISOString(),
    object: { type: row.entity_type, id: row.entity_id },
  };
}

export async function listReviewDecisionAudit(
  ctx: Ctx<AuditDatabase>,
  input: { organizationId?: string; entityId?: string; limit?: number } = {},
): Promise<ReviewDecisionEntry[]> {
  let query = ctx.db
    .selectFrom("audit_logs")
    .selectAll()
    .where("action", "in", [...REVIEW_DECISION_ACTIONS]);
  if (input.organizationId !== undefined) query = query.where("organization_id", "=", input.organizationId);
  if (input.entityId !== undefined) query = query.where("entity_id", "=", input.entityId);
  const rows = await query
    .orderBy("occurred_at", "desc")
    .orderBy("id", "desc")
    .limit(input.limit ?? DEFAULT_LIMIT)
    .execute();
  return rows.map(toReviewDecisionEntry);
}
