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
  credentialSchema: readonly CredentialField[];
}

const MAX_ACCOUNT_REF = 128;
const MAX_CREDENTIAL = 4096;

export interface CredentialField {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
}
type ParsedAccount =
  | { ok: true; accountRef: string; credential: Record<string, string | number | boolean> }
  | { ok: false; reason: string };

// Reasons name the field and the rule. They never echo the submitted value, so a rejected credential stays out of logs.
function parseAccount(body: unknown, schema: readonly CredentialField[]): ParsedAccount {
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const accountRef = typeof raw.account_ref === "string" ? raw.account_ref.trim() : "";
  if (accountRef === "") return { ok: false, reason: "account_ref is required" };
  if (accountRef.length > MAX_ACCOUNT_REF) return { ok: false, reason: "account_ref is too long" };
  const credential = raw.credential;
  if (Object.hasOwn(raw, "credential_schema")) return { ok: false, reason: "credential_schema is not accepted" };
  if (schema.length === 0) return { ok: false, reason: "credential schema is unavailable" };
  if (typeof credential !== "object" || credential === null || Array.isArray(credential))
    return { ok: false, reason: "credential is required" };
  const fields = schema;
  const values = credential as Record<string, unknown>;
  const allowed = new Set(fields.map((field) => field.name));
  if (Object.keys(values).some((key) => !allowed.has(key)))
    return { ok: false, reason: "credential contains undeclared fields" };
  const result: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined && !field.required) continue;
    if (
      (field.type === "string" && typeof value !== "string") ||
      (field.type === "number" && typeof value !== "number") ||
      (field.type === "boolean" && typeof value !== "boolean")
    )
      return { ok: false, reason: `credential field ${field.name} is invalid` };
    result[field.name] = value as string | number | boolean;
  }
  if (JSON.stringify(result).length > MAX_CREDENTIAL) return { ok: false, reason: "credential is too long" };
  return { ok: true, accountRef, credential: result };
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
  if (ctx.actor.type !== "user" || parseId("user", ctx.actor.id) === null)
    return { ok: false, code: "UNAUTHENTICATED" };

  const parsed = parseAccount(body, deps.credentialSchema);
  if (!parsed.ok) return { ok: false, code: "VALIDATION_FAILED", reason: parsed.reason };

  const id: Id<"networkAccount"> = ctx.ids.next("networkAccount");
  const createdAt = ctx.clock.now();
  const sealedCredential = deps.secretBox.seal(JSON.stringify(parsed.credential), id);

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
