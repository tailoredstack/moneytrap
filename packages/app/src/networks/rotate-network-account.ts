import { parseId } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { NetworkAccountStore, NetworkAccountView } from "../ports/network-account-store";
import type { SecretBox } from "../ports/secret-box";
import type { CredentialField } from "./register-network-account";

export type RotateNetworkAccountResult =
  | { ok: true; value: NetworkAccountView }
  | { ok: false; code: "UNAUTHENTICATED" }
  | { ok: false; code: "VALIDATION_FAILED"; reason: string }
  | { ok: false; code: "RESOURCE_NOT_FOUND" };

export interface RotateNetworkAccountDeps {
  store: NetworkAccountStore;
  secretBox: SecretBox;
}
export interface RotateNetworkAccountInput {
  accountId: string;
  credential: unknown;
  credentialSchema: readonly CredentialField[];
}

function validateCredential(credential: unknown, schema: readonly CredentialField[]) {
  if (schema.length === 0) return { ok: false as const, reason: "credential schema is required" };
  if (typeof credential !== "object" || credential === null || Array.isArray(credential))
    return { ok: false as const, reason: "credential is required" };
  const values = credential as Record<string, unknown>;
  const allowed = new Set(schema.map((field) => field.name));
  if (Object.keys(values).some((key) => !allowed.has(key)))
    return { ok: false as const, reason: "credential contains undeclared fields" };
  const result: Record<string, string | number | boolean> = {};
  for (const field of schema) {
    const value = values[field.name];
    if (value === undefined && !field.required) continue;
    if (
      (field.type === "string" && typeof value !== "string") ||
      (field.type === "number" && typeof value !== "number") ||
      (field.type === "boolean" && typeof value !== "boolean")
    )
      return { ok: false as const, reason: `credential field ${field.name} is invalid` };
    result[field.name] = value as string | number | boolean;
  }
  if (JSON.stringify(result).length > 4096) return { ok: false as const, reason: "credential is too long" };
  return { ok: true as const, value: result };
}

export async function rotateNetworkAccount(
  ctx: Ctx,
  deps: RotateNetworkAccountDeps,
  input: RotateNetworkAccountInput,
): Promise<RotateNetworkAccountResult> {
  if (ctx.actor.type !== "user" || parseId("user", ctx.actor.id) === null)
    return { ok: false, code: "UNAUTHENTICATED" };
  const id = parseId("networkAccount", input.accountId);
  if (!id) return { ok: false, code: "RESOURCE_NOT_FOUND" };
  const parsed = validateCredential(input.credential, input.credentialSchema);
  if (!parsed.ok) return { ok: false, code: "VALIDATION_FAILED", reason: parsed.reason };
  const sealedCredential = deps.secretBox.seal(JSON.stringify(parsed.value), id);
  const updated = await deps.store.rotateCredential(id, sealedCredential, {
    id: ctx.ids.next("audit"),
    actor: { type: ctx.actor.type, id: ctx.actor.id as string },
    action: "network_account.rotated",
    entityId: id,
    metadata: { keyId: sealedCredential.keyId },
    occurredAt: ctx.clock.now(),
  });
  return updated ? { ok: true, value: updated } : { ok: false, code: "RESOURCE_NOT_FOUND" };
}
