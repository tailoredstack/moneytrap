import type { Id, Membership, Role } from "@moneytrap/domain";
import { type Kysely, sql } from "kysely";

// Reads a user's memberships from the memberships table (DM-006). The only source of roles, so a guard's decision is
// the stored role and nothing the client sent.
export function createMembershipReader(db: Kysely<unknown>): (userId: Id<"user">) => Promise<readonly Membership[]> {
  return async (userId) => {
    const result = await sql<{ organization_id: string; role: Role }>`
      select organization_id, role from memberships where user_id = ${userId}`.execute(db);
    return result.rows.map((row) => ({ organizationId: row.organization_id as Id<"organization">, role: row.role }));
  };
}
