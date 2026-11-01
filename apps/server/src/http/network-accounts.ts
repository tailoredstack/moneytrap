import { RAKUTEN_CAPABILITIES, RAKUTEN_CREDENTIAL_SCHEMA, RakutenConnector } from "@moneytrap/adapter-network-rakuten";
import type { Clock, IdGenerator } from "@moneytrap/app";
import type { Ctx } from "@moneytrap/app/src/ctx";
import { registerNetworkAccount } from "@moneytrap/app/src/networks/register-network-account";
import { rotateNetworkAccount } from "@moneytrap/app/src/networks/rotate-network-account";
import { testNetworkAccountConnection } from "@moneytrap/app/src/networks/test-network-account-connection";
import type { NetworkAccountStore } from "@moneytrap/app/src/ports/network-account-store";
import type { SecretBox } from "@moneytrap/app/src/ports/secret-box";
import { Elysia, t } from "elysia";
import { errorResponse } from "./error-map";
import { guard, type PrincipalResolver } from "./guards/enforce";
import { requestIdOf } from "./request-id";

export const NETWORK_ACCOUNT_REGISTER_PATH = "/v1/admin/network-accounts";
export const NETWORK_ACCOUNT_REGISTER_KEY = `POST ${NETWORK_ACCOUNT_REGISTER_PATH}`;

export interface NetworkAccountWiring {
  db: unknown;
  store: NetworkAccountStore;
  secretBox: SecretBox;
  clock: Clock;
  ids: IdGenerator;
  principal: PrincipalResolver;
  createConnector?: (
    credentials: Record<string, string | number | boolean>,
    accountRef: string,
    clock: Clock,
  ) => Pick<RakutenConnector, "validateConnection">;
}

export function networkAccountRoutes(wiring?: NetworkAccountWiring) {
  const app = new Elysia({ name: "network-accounts" });
  if (!wiring) return app;
  const callers = new WeakMap<Headers, ReturnType<PrincipalResolver>>();
  const principal: PrincipalResolver = (headers) => {
    let caller = callers.get(headers);
    if (!caller) {
      caller = wiring.principal(headers);
      callers.set(headers, caller);
    }
    return caller;
  };
  return app
    .post(
      NETWORK_ACCOUNT_REGISTER_PATH,
      {
        ...guard(NETWORK_ACCOUNT_REGISTER_KEY, principal),
        body: t.Object({
          network_id: t.String(),
          account_ref: t.String(),
          credentials: t.Record(t.String(), t.Union([t.String(), t.Number(), t.Boolean()])),
        }),
      },
      async ({ body, request, set }) => {
        const caller = await principal(request.headers);
        const result = await registerNetworkAccount(
          {
            db: wiring.db as Ctx["db"],
            clock: wiring.clock,
            ids: wiring.ids,
            actor: { type: "user", id: caller?.userId ?? null },
          },
          { store: wiring.store, secretBox: wiring.secretBox, credentialSchema: RAKUTEN_CREDENTIAL_SCHEMA },
          body.network_id,
          { account_ref: body.account_ref, credential: body.credentials },
        );
        if (!result.ok) {
          const { status, body: error } = errorResponse(result.code, requestIdOf(request), "Request failed");
          set.status = status;
          return error;
        }
        set.status = 201;
        return {
          data: {
            id: result.value.id,
            network_id: result.value.networkId,
            account_ref: result.value.accountRef,
            credential_status: result.value.state,
          },
        };
      },
    )
    .put(
      "/v1/admin/network-accounts/:id/credentials",
      {
        ...guard("PUT /v1/admin/network-accounts/:id/credentials", principal),
        body: t.Object({ credentials: t.Record(t.String(), t.Union([t.String(), t.Number(), t.Boolean()])) }),
      },
      async ({ params, body, request, set }) => {
        const caller = await principal(request.headers);
        const result = await rotateNetworkAccount(
          {
            db: wiring.db as Ctx["db"],
            clock: wiring.clock,
            ids: wiring.ids,
            actor: { type: "user", id: caller?.userId ?? null },
          },
          { store: wiring.store, secretBox: wiring.secretBox },
          { accountId: params.id, credential: body.credentials, credentialSchema: RAKUTEN_CREDENTIAL_SCHEMA },
        );
        if (!result.ok) {
          const { status, body: error } = errorResponse(result.code, requestIdOf(request), "Request failed");
          set.status = status;
          return error;
        }
        set.status = 200;
        return {
          data: {
            id: result.value.id,
            credential_status: result.value.state,
            rotated_at: wiring.clock.now().toISOString(),
          },
        };
      },
    )
    .post(
      "/v1/admin/network-accounts/:id/test-connection",
      { ...guard("POST /v1/admin/network-accounts/:id/test-connection", principal) },
      async ({ params, request, set }) => {
        const caller = await principal(request.headers);
        const result = await testNetworkAccountConnection(
          {
            db: wiring.db as Ctx["db"],
            clock: wiring.clock,
            ids: wiring.ids,
            actor: { type: "user", id: caller?.userId ?? null },
          },
          {
            store: wiring.store,
            secretBox: wiring.secretBox,
            validate: async (credentials, accountRef) =>
              (
                wiring.createConnector?.(credentials, accountRef, wiring.clock) ??
                new RakutenConnector({
                  clientId: String(credentials.clientId ?? ""),
                  clientSecret: String(credentials.clientSecret ?? ""),
                  accountId: accountRef,
                  clock: wiring.clock,
                  fetch: async () => Response.json({ advertisers: [] }),
                })
              ).validateConnection(),
          },
          params.id,
        );
        if (!result.ok) {
          const { status, body } = errorResponse(result.code, requestIdOf(request), "Request failed");
          set.status = status;
          return body;
        }
        set.status = 200;
        return { data: { connection_status: result.value.connectionStatus, capabilities: RAKUTEN_CAPABILITIES } };
      },
    );
}
