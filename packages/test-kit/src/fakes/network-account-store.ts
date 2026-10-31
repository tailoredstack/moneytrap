import type {
  NetworkAccountInsertOutcome,
  NetworkAccountStore,
  NetworkAccountView,
  NetworkAccountWrite,
} from "@moneytrap/app/src/ports/network-account-store";
import type { SealedSecret } from "@moneytrap/app/src/ports/secret-box";
import type { Id } from "@moneytrap/domain";

/** In-memory reference adapter for the network account store. It enforces the same uniqueness and network checks. */
export class FakeNetworkAccountStore implements NetworkAccountStore {
  readonly networks = new Set<string>();
  readonly accounts = new Map<string, NetworkAccountWrite>();
  readonly audits: NetworkAccountWrite["audit"][] = [];

  async insert(write: NetworkAccountWrite): Promise<NetworkAccountInsertOutcome> {
    if (!this.networks.has(write.networkId)) return "unknown_network";
    const taken = [...this.accounts.values()].some(
      (account) => account.networkId === write.networkId && account.accountRef === write.accountRef,
    );
    if (taken) return "duplicate";
    this.accounts.set(write.id, { ...write });
    this.audits.push({ ...write.audit });
    return "created";
  }

  async listForNetwork(networkId: string): Promise<NetworkAccountView[]> {
    // Built field by field, the same as the pg adapter, so no sealed credential can leave through this method.
    return [...this.accounts.values()]
      .filter((account) => account.networkId === networkId)
      .map((account) => ({
        id: account.id,
        networkId: account.networkId,
        accountRef: account.accountRef,
        state: account.state,
        lastCheckedAt: null,
        createdAt: account.createdAt,
      }));
  }

  async readSealedCredential(id: Id<"networkAccount">): Promise<SealedSecret | null> {
    const account = this.accounts.get(id);
    return account ? { ...account.sealedCredential } : null;
  }
}
