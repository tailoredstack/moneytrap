import type { OrganizationStore, OrganizationWrite } from "@moneytrap/app/src/ports/organization-store";
import { type Kysely, sql } from "kysely";
import { withTx } from "../transaction";

// Writes the organization and its owner membership in one transaction, so both exist or neither does (TP-W2-027).
export function createOrganizationStore(db: Kysely<unknown>): OrganizationStore {
  return {
    async createWithOwner({ organization: org, ownerMembership: member }: OrganizationWrite) {
      await withTx(db, async (tx) => {
        await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
          values (${org.id}, ${org.name}, ${org.country}, ${org.baseCurrency}, ${org.status}, ${org.createdBy}, ${org.createdAt}, ${org.updatedAt})`.execute(
          tx,
        );
        await sql`insert into memberships (organization_id, user_id, role)
          values (${member.organizationId}, ${member.userId}, ${member.role})`.execute(tx);
      });
    },
  };
}
