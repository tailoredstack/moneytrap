import type { StatementStore } from "@moneytrap/app";
import { type CurrencyCode, isCurrencyCode, parseId } from "@moneytrap/domain";
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
      if (!authenticated) return fail(set, request, "UNAUTHENTICATED");
      if (query.currency !== undefined && !isCurrencyCode(query.currency))
        return fail(set, request, "VALIDATION_FAILED");
      const currency = query.currency as CurrencyCode | undefined;
      const year = number(query.year),
        month = number(query.month);
      if (
        (query.year !== undefined && (year === undefined || !Number.isInteger(year) || year < 1)) ||
        (query.month !== undefined && (month === undefined || !Number.isInteger(month) || month < 1 || month > 12))
      )
        return fail(set, request, "VALIDATION_FAILED");
      const records = await store.listForOrganization?.(authenticated.userId, organizationId);
      if (!records) return fail(set, request, "INTERNAL");
      return {
        data: records
          .filter(
            (record) =>
              (year === undefined || record.periodStart.getUTCFullYear() === year) &&
              (month === undefined || record.periodStart.getUTCMonth() + 1 === month) &&
              (currency === undefined || record.currency === currency),
          )
          .map(serialize),
      };
    })
    .get(STATEMENT_PATH, guard(STATEMENT_KEY, principal), async ({ params, request, set }) => {
      const authenticated = await principal(request.headers);
      const organizationId = parseId("organization", (params as Record<string, string>).organizationId);
      if (!organizationId) return fail(set, request, "VALIDATION_FAILED");
      if (!authenticated) return fail(set, request, "UNAUTHENTICATED");
      const record = await store.findForOrganization?.(
        authenticated.userId,
        organizationId,
        params.statementId as never,
      );
      if (!record) return fail(set, request, "RESOURCE_NOT_FOUND");
      const downloadUrl = await store.downloadUrl(record.objectRef);
      if (!/^https:\/\//.test(downloadUrl)) return fail(set, request, "INTERNAL");
      return new Response(null, {
        status: 302,
        headers: { location: downloadUrl },
      });
    });
}

function number(value?: string): number | undefined {
  return value === undefined || !/^\d+$/.test(value) ? undefined : Number(value);
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
