import { parseId } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { NetworkAccountStore } from "../ports/network-account-store";
import type { ConnectionCheck, ConnectorResult } from "../ports/network-connector";
import type { SecretBox } from "../ports/secret-box";

export type TestNetworkAccountConnectionResult =
  | {
      ok: true;
      value: { connectionStatus: "connected" | "not_authorized" | "unavailable"; check: ConnectionCheck | null };
    }
  | { ok: false; code: "UNAUTHENTICATED" | "RESOURCE_NOT_FOUND" };

export async function testNetworkAccountConnection(
  ctx: Ctx,
  deps: {
    store: NetworkAccountStore;
    secretBox: SecretBox;
    validate: (
      credentials: Record<string, string | number | boolean>,
      accountRef: string,
    ) => Promise<ConnectorResult<ConnectionCheck>>;
  },
  accountId: string,
): Promise<TestNetworkAccountConnectionResult> {
  if (ctx.actor.type !== "user" || parseId("user", ctx.actor.id) === null)
    return { ok: false, code: "UNAUTHENTICATED" };
  const id = parseId("networkAccount", accountId);
  if (!id) return { ok: false, code: "RESOURCE_NOT_FOUND" };
  const account = await deps.store.findForConnection(id);
  if (!account) return { ok: false, code: "RESOURCE_NOT_FOUND" };
  let credentials: Record<string, string | number | boolean>;
  try {
    credentials = JSON.parse(deps.secretBox.open(account.sealedCredential, id));
  } catch {
    return { ok: true, value: { connectionStatus: "unavailable", check: null } };
  }
  const result = await deps.validate(credentials, account.accountRef);
  if (!result.ok)
    return {
      ok: true,
      value: {
        connectionStatus: result.failure.state === "not_authorized" ? "not_authorized" : "unavailable",
        check: null,
      },
    };
  return { ok: true, value: { connectionStatus: "connected", check: result.value } };
}
