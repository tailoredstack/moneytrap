import { type Id, parseId } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { NetworkAccountStore, NetworkAccountView } from "../ports/network-account-store";
import type { SecretBox } from "../ports/secret-box";

export type RegisterNetworkAccountResult =
  | { ok: true; value: NetworkAccountView }
  | { ok: false; code: "UNAUTHENTICATED" }
  | { ok: false; code: "VALIDATION_FAILED"; reason: string }
  | { ok: false; code: "RESOURCE_NOT_FOUND" }
  | { ok: false; code: "STATE_CONFLICT" };

export interface RegisterNetworkAccountDeps {
  store: NetworkAccountStore;
  secretBox: SecretBox;
}

const MAX_ACCOUNT_REF = 128;
const MAX_CREDENTIAL = 4096;

type ParsedAccount = { ok: true; accountRef: string; credential: string } | { ok: false; reason: string };

// Reasons name the field and the rule. They never echo the submitted value, so a rejected credential stays out of logs.
function parseAccount(body: unknown): ParsedAccount {
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const accountRef = typeof raw.account_ref === "string" ? raw.account_ref.trim() : "";
  if (accountRef === "") return { ok: false, reason: "account_ref is required" };
  if (accountRef.length > MAX_ACCOUNT_REF) return { ok: false, reason: "account_ref is too long" };
  const credential = raw.credential;
  if (typeof credential !== "string" || credential === "") return { ok: false, reason: "credential is required" };
  if (credential.length > MAX_CREDENTIAL) return { ok: false, reason: "credential is too long" };
  return { ok: true, accountRef, credential };
}

// Registers a network account and seals its credential under the active key (DM-016, WP-4.4). The account row, the
// sealed credential, and the audit row commit together. The result is built field by field, so the credential cannot
// reach the caller through it.
export async function registerNetworkAccount(
  ctx: Ctx,
  deps: RegisterNetworkAccountDeps,
  networkId: string,
  body: unknown,
): Promise<RegisterNetworkAccountResult> {
  if (ctx.actor.type !== "user" || parseId("user", ctx.actor.id) === null) {
    return { ok: false, code: "UNAUTHENTICATED" };
  }

  const parsed = parseAccount(body);
  if (!parsed.ok) return { ok: false, code: "VALIDATION_FAILED", reason: parsed.reason };

  const id: Id<"networkAccount"> = ctx.ids.next("networkAccount");
  const createdAt = ctx.clock.now();
  const sealedCredential = deps.secretBox.seal(parsed.credential, id);

  const outcome = await deps.store.insert({
    id,
    networkId,
    accountRef: parsed.accountRef,
    sealedCredential,
    state: "unverified",
    createdAt,
    audit: {
      id: ctx.ids.next("audit"),
      actor: { type: ctx.actor.type, id: ctx.actor.id as string },
      action: "network_account.registered",
      entityId: id,
      metadata: { networkId, keyId: sealedCredential.keyId },
      occurredAt: createdAt,
    },
  });
  if (outcome === "unknown_network") return { ok: false, code: "RESOURCE_NOT_FOUND" };
  if (outcome === "duplicate") return { ok: false, code: "STATE_CONFLICT" };

  return {
    ok: true,
    value: {
      id,
      networkId,
      accountRef: parsed.accountRef,
      state: "unverified",
      lastCheckedAt: null,
      createdAt,
    },
  };
}
