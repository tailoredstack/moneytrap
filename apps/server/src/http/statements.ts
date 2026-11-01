import { listStatements, type StatementStore } from "@moneytrap/app";
import { parseId } from "@moneytrap/domain";
import { Elysia } from "elysia";
import { errorResponse } from "./error-map";
import { guard, type PrincipalResolver } from "./guards/enforce";
import { requestIdOf } from "./request-id";

export const STATEMENTS_PATH = "/v1/organizations/:organizationId/statements";
export const STATEMENTS_KEY = `GET ${STATEMENTS_PATH}`;
export const STATEMENT_PATH = "/v1/organizations/:organizationId/statements/:statementId/download";
export const STATEMENT_KEY = `GET ${STATEMENT_PATH}`;
export interface StatementWiring {
  store: StatementStore;
  principal: PrincipalResolver;
}

export function statementRoutes(wiring?: StatementWiring) {
  const app = new Elysia({ name: "statements" });
  if (!wiring) return app;
  const { store, principal } = wiring;
  return app
    .get(STATEMENTS_PATH, guard(STATEMENTS_KEY, principal), async ({ params, query, request, set }) => {
      const authenticated = await principal(request.headers);
      const organizationId = parseId("organization", params.organizationId);
      if (!organizationId) return fail(set, request, "VALIDATION_FAILED");
      const publisherId = await store.publisherForUser?.(authenticated?.userId, organizationId);
      if (!publisherId) return fail(set, request, authenticated ? "RESOURCE_NOT_FOUND" : "UNAUTHENTICATED");
      const currencies = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "KRW", "BHD"] as const;
      if (query.currency && !currencies.includes(query.currency as (typeof currencies)[number]))
        return fail(set, request, "VALIDATION_FAILED");
      const currency = query.currency as (typeof currencies)[number] | undefined;
      const year = number(query.year),
        month = number(query.month);
      if ((query.year !== undefined && year === undefined) || (query.month !== undefined && month === undefined))
        return fail(set, request, "VALIDATION_FAILED");
      const result = await listStatements(
        { store },
        {
          publisherId,
          ...(year === undefined ? {} : { year }),
          ...(month === undefined ? {} : { month }),
          ...(currency ? { currency } : {}),
        },
      );
      if (!result.ok) return fail(set, request, result.code);
      return { data: result.value.map(serialize) };
    })
    .get(STATEMENT_PATH, guard(STATEMENT_KEY, principal), async ({ params, request, set }) => {
      const authenticated = await principal(request.headers);
      const organizationId = parseId("organization", (params as Record<string, string>).organizationId);
      if (!organizationId) return fail(set, request, "VALIDATION_FAILED");
      const publisherId = await store.publisherForUser?.(authenticated?.userId, organizationId);
      if (!publisherId) return fail(set, request, authenticated ? "RESOURCE_NOT_FOUND" : "UNAUTHENTICATED");
      const record = (await store.list(publisherId)).find((item) => item.id === params.statementId);
      if (!record) return fail(set, request, "RESOURCE_NOT_FOUND");
      return new Response(null, {
        status: 302,
        headers: { location: (await store.downloadUrl?.(record.objectRef)) ?? `/v1/statements/${record.id}` },
      });
    });
}

function number(value?: string): number | undefined {
  return value === undefined ? undefined : Number(value);
}
function serialize(record: Awaited<ReturnType<StatementStore["list"]>>[number]) {
  return {
    id: record.id,
    publisher_id: record.publisherId,
    currency: record.currency,
    period_start: record.periodStart.toISOString(),
    period_end: record.periodEnd.toISOString(),
    revision: record.revision,
    content_hash: record.contentHash,
    object_ref: record.objectRef,
    content: record.content,
    created_at: record.createdAt.toISOString(),
  };
}
function fail(set: { status?: number | string }, request: Request, code: string) {
  const { status, body } = errorResponse(code, requestIdOf(request), "Request failed");
  set.status = status;
  return body;
}
