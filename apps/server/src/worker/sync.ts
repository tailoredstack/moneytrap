import { RAKUTEN_CREDENTIAL_SCHEMA, RakutenConnector } from "@moneytrap/adapter-network-rakuten";
import { type SyncCatalogResult, syncCatalog } from "@moneytrap/app/src/networks/sync-catalog";
import type { CatalogSyncStore } from "@moneytrap/app/src/ports/catalog-sync-store";
import type { Clock } from "@moneytrap/app/src/ports/clock";
import type { IdGenerator } from "@moneytrap/app/src/ports/id-generator";
import type { NetworkAccountStore } from "@moneytrap/app/src/ports/network-account-store";
import type { NetworkConnector } from "@moneytrap/app/src/ports/network-connector";
import type { SecretBox } from "@moneytrap/app/src/ports/secret-box";
import { parseId } from "@moneytrap/domain";

type ConnectionCredentials = { clientId: string; clientSecret: string };

export interface CatalogSyncWorkerOptions {
  store: CatalogSyncStore;
  clock: Clock;
  ids: IdGenerator;
  networkAccounts: Pick<NetworkAccountStore, "listForNetwork" | "readSealedCredential">;
  secretBox: SecretBox;
  // Tests or future network adapters can override construction. Ordinary sync receives only access credentials;
  // optional capability-specific secrets such as web_security_token are intentionally withheld.
  createConnector?: (credentials: ConnectionCredentials, accountRef: string, clock: Clock) => NetworkConnector;
  sleep?: (ms: number) => Promise<void>;
  // Total attempts for one run, including the first. Only temporarily_unavailable is retried.
  maxAttempts?: number;
  baseBackoffMs?: number;
}

const MAX_BACKOFF_MS = 60_000;

// Loads and opens one stored account for its normal network worker run. Connector input, result, and retry paths never
// expose the decrypted credential; optional capability secrets are not passed into ordinary sync construction.
// A retry resumes the scope that was in progress from its saved cursor. Scopes that already completed in this run are
// walked again; that is harmless, because every revision is compared with the latest one before it is written.
export async function runCatalogSync(
  options: CatalogSyncWorkerOptions,
  networkId: string,
  networkAccountId: string,
): Promise<SyncCatalogResult> {
  const id = parseId("networkAccount", networkAccountId);
  if (!id) return notAuthorized();

  const account = (await options.networkAccounts.listForNetwork(networkId)).find((candidate) => candidate.id === id);
  if (!account) return notAuthorized();
  const sealed = await options.networkAccounts.readSealedCredential(id);
  if (!sealed) return notAuthorized();

  let credentials: Record<string, string | number | boolean>;
  try {
    credentials = JSON.parse(options.secretBox.open(sealed, id));
  } catch {
    return notAuthorized();
  }
  const connectionCredentials = parseConnectionCredentials(credentials);
  if (!connectionCredentials) return notAuthorized();

  let connector: NetworkConnector;
  try {
    connector =
      options.createConnector?.(connectionCredentials, account.accountRef, options.clock) ??
      new RakutenConnector({
        clientId: connectionCredentials.clientId,
        clientSecret: connectionCredentials.clientSecret,
        accountId: account.accountRef,
        clock: options.clock,
      });
  } catch {
    return notAuthorized();
  }

  const { sleep = (ms) => Bun.sleep(ms), maxAttempts = 3, baseBackoffMs = 1_000 } = options;
  for (let attempt = 1; ; attempt++) {
    const result = await syncCatalog(
      { connector, store: options.store, clock: options.clock, ids: options.ids },
      { networkId },
    );
    if (result.ok) return result;
    if (result.failure.state !== "temporarily_unavailable" || attempt >= maxAttempts) return result;
    const retryAfterMs = result.failure.retryAfterSeconds === null ? null : result.failure.retryAfterSeconds * 1_000;
    const delayMs = retryAfterMs ?? baseBackoffMs * 2 ** (attempt - 1);
    await sleep(Math.min(delayMs, MAX_BACKOFF_MS));
  }
}

function parseConnectionCredentials(value: unknown): ConnectionCredentials | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const credential = value as Record<string, unknown>;
  const declared = new Map(RAKUTEN_CREDENTIAL_SCHEMA.map((field) => [field.name, field]));
  for (const [name, fieldValue] of Object.entries(credential)) {
    const field = declared.get(name);
    if (field?.type !== "string" || typeof fieldValue !== "string") return null;
  }
  for (const field of RAKUTEN_CREDENTIAL_SCHEMA) {
    if (field.required && typeof credential[field.name] !== "string") return null;
  }
  return {
    clientId: credential.clientId as string,
    clientSecret: credential.clientSecret as string,
  };
}

function notAuthorized(): SyncCatalogResult {
  return { ok: false, failure: { state: "not_authorized" } };
}
