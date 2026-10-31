import type {
  NetworkAccountInsertOutcome,
  NetworkAccountStore,
  NetworkAccountView,
  NetworkAccountWrite,
} from "@moneytrap/app/src/ports/network-account-store";
import type { SealedSecret } from "@moneytrap/app/src/ports/secret-box";
import type { Id } from "@moneytrap/domain";
import { type Kysely, sql } from "kysely";
import { withTx } from "../transaction";

interface AccountRow {
  id: string;
  network_id: string;
  account_ref: string;
  state: string;
  last_checked_at: Date | null;
  created_at: Date;
}

// Account rows are read with an explicit column list. The credential columns are never selected here, so a list cannot
// carry them, even if a caller later adds a field to the view.
export function createNetworkAccountStore(db: Kysely<unknown>): NetworkAccountStore {
  return {
    async insert(write: NetworkAccountWrite): Promise<NetworkAccountInsertOutcome> {
      return withTx(db, async (tx) => {
        const network = await sql<{ id: string }>`select id from networks where id = ${write.networkId}`.execute(tx);
        if (network.rows.length === 0) return "unknown_network";

        const inserted = await sql<{ id: string }>`
          insert into network_accounts (id, network_id, account_ref, state, credential_ciphertext, credential_key_id,
            created_at, updated_at)
          values (${write.id}, ${write.networkId}, ${write.accountRef}, ${write.state}, ${write.sealedCredential.ciphertext},
            ${write.sealedCredential.keyId}, ${write.createdAt}, ${write.createdAt})
          on conflict (network_id, account_ref) do nothing
          returning id
        `.execute(tx);
        if (inserted.rows.length === 0) return "duplicate";

        // Same transaction as the account, so the audit row exists if and only if the account does.
        await sql`insert into audit_logs (id, organization_id, actor_type, actor_id, action, entity_type, entity_id,
          metadata, occurred_at)
          values (${write.audit.id}, null, ${write.audit.actor.type}, ${write.audit.actor.id}, ${write.audit.action},
            'network_account', ${write.audit.entityId}, ${JSON.stringify(write.audit.metadata)}::jsonb,
            ${write.audit.occurredAt})`.execute(tx);
        return "created";
      });
    },

    async listForNetwork(networkId: string): Promise<NetworkAccountView[]> {
      const { rows } = await sql<AccountRow>`
        select id, network_id, account_ref, state, last_checked_at, created_at
        from network_accounts
        where network_id = ${networkId}
        order by created_at, id
      `.execute(db);
      return rows.map((row) => ({
        id: row.id as Id<"networkAccount">,
        networkId: row.network_id,
        accountRef: row.account_ref,
        state: row.state,
        lastCheckedAt: row.last_checked_at,
        createdAt: row.created_at,
      }));
    },

    async readSealedCredential(id: Id<"networkAccount">): Promise<SealedSecret | null> {
      const { rows } = await sql<{ credential_ciphertext: string; credential_key_id: string }>`
        select credential_ciphertext, credential_key_id from network_accounts where id = ${id}
      `.execute(db);
      const row = rows[0];
      if (!row) return null;
      return { keyId: row.credential_key_id, ciphertext: row.credential_ciphertext };
    },
  };
}
