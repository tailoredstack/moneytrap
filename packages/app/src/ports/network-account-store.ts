import type { Id } from "@moneytrap/domain";
import type { SealedSecret } from "./secret-box";

// The account as the rest of the platform may see it. It has no credential field: the sealed secret is kept behind
// readSealedCredential, which only the connector uses, so no response can be built from this type by accident.
export interface NetworkAccountView {
  id: Id<"networkAccount">;
  networkId: string;
  accountRef: string;
  state: string;
  lastCheckedAt: Date | null;
  createdAt: Date;
}

export interface NetworkAccountAudit {
  id: Id<"audit">;
  actor: { type: string; id: string };
  action: "network_account.registered";
  entityId: Id<"networkAccount">;
  // Only identifiers belong here. The credential and its ciphertext never reach the audit row.
  metadata: { networkId: string; keyId: string };
  occurredAt: Date;
}

export interface NetworkAccountWrite {
  id: Id<"networkAccount">;
  networkId: string;
  accountRef: string;
  sealedCredential: SealedSecret;
  state: string;
  createdAt: Date;
  audit: NetworkAccountAudit;
}

// `created` means the account and its audit row committed together. `duplicate` means the network already has an
// account with this reference, and `unknown_network` means the network does not exist. Neither writes anything.
export type NetworkAccountInsertOutcome = "created" | "duplicate" | "unknown_network";

export interface NetworkAccountStore {
  insert(write: NetworkAccountWrite): Promise<NetworkAccountInsertOutcome>;
  listForNetwork(networkId: string): Promise<NetworkAccountView[]>;
  // Used by the sync worker to open the credential. No API route may call this.
  readSealedCredential(id: Id<"networkAccount">): Promise<SealedSecret | null>;
}
