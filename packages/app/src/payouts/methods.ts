import {
  type CurrencyCode,
  can,
  type ErrorCode,
  type Id,
  isCurrencyCode,
  type Permission,
  type Principal,
  parseId,
  type Scope,
} from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { PayoutMethodRecord, PayoutMethodStore } from "../ports/payout-method-store";

export interface PayoutMethodView {
  id: Id<"payoutMethod">;
  publisherId: Id<"publisher">;
  provider: string;
  // A reference issued by the provider. The account behind it never reaches the platform (TP-W7-008).
  providerAccountRef: string;
  country: string;
  currency: CurrencyCode;
  state: string;
  verifiedAt: Date | null;
  createdAt: Date;
}

type Failure = { ok: false; code: ErrorCode; reason?: string };

export type EnrollPayoutMethodResult = { ok: true; value: PayoutMethodView } | Failure;
export type ListPayoutMethodsResult = { ok: true; value: PayoutMethodView[] } | Failure;
export type DisablePayoutMethodResult = { ok: true; value: { id: Id<"payoutMethod">; state: "disabled" } } | Failure;

export interface PayoutMethodDeps {
  store: PayoutMethodStore;
}

// The only fields an enrollment accepts. Anything else, including raw account details, is refused before any value is
// read, so a schema-level miss cannot store an account number (TP-W7-008, §4.4).
const ENROLL_FIELDS = ["provider", "provider_account_ref", "country", "currency"] as const;
const PROVIDER_RE = /^[a-z][a-z0-9_]{1,31}$/;
const PROVIDER_REF_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

type ParsedEnrollment =
  | { ok: true; provider: string; providerAccountRef: string; country: string; currency: CurrencyCode }
  | { ok: false; reason: string };

// Reasons name the field and the rule. They never echo the submitted value, so a rejected account detail stays out of logs.
function parseEnrollment(body: unknown): ParsedEnrollment {
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (raw === null) return { ok: false, reason: "body must be an object" };
  const unexpected = Object.keys(raw).find((key) => !(ENROLL_FIELDS as readonly string[]).includes(key));
  if (unexpected !== undefined) return { ok: false, reason: `${unexpected} is not an accepted field` };

  const { provider, provider_account_ref: providerAccountRef, country, currency } = raw;
  if (typeof provider !== "string" || !PROVIDER_RE.test(provider)) return { ok: false, reason: "provider is invalid" };
  if (typeof providerAccountRef !== "string" || !PROVIDER_REF_RE.test(providerAccountRef)) {
    return { ok: false, reason: "provider_account_ref is invalid" };
  }
  if (typeof country !== "string" || !COUNTRY_RE.test(country)) return { ok: false, reason: "country is invalid" };
  if (typeof currency !== "string" || !isCurrencyCode(currency)) return { ok: false, reason: "currency is invalid" };
  return { ok: true, provider, providerAccountRef, country, currency };
}

// Grants come only from membership in the scope. The actor must be the principal, so one user cannot act as another.
function authorize(ctx: Ctx, principal: Principal, scope: Scope, permission: Permission): Failure | null {
  if (ctx.actor.type !== "user" || ctx.actor.id !== principal.userId) return { ok: false, code: "UNAUTHENTICATED" };
  if (!can(principal, permission, scope)) return { ok: false, code: "FORBIDDEN" };
  return null;
}

function toView(record: PayoutMethodRecord): PayoutMethodView {
  return {
    id: record.id,
    publisherId: record.publisherId,
    provider: record.provider,
    providerAccountRef: record.providerAccountRef,
    country: record.country,
    currency: record.currency,
    state: record.state,
    verifiedAt: record.verifiedAt,
    createdAt: record.createdAt,
  };
}

// Enrolls a payout method through the provider-hosted flow (DM-046, TP-W7-007). The method is active with the provider's
// reference and nothing else. The reference is unique per provider, and a publisher outside the organization is not found.
export async function enrollPayoutMethod(
  ctx: Ctx,
  deps: PayoutMethodDeps,
  principal: Principal,
  scope: Scope,
  publisherId: Id<"publisher">,
  body: unknown,
): Promise<EnrollPayoutMethodResult> {
  const denied = authorize(ctx, principal, scope, "payouts:write");
  if (denied) return denied;
  if (parseId("publisher", publisherId) === null) return { ok: false, code: "RESOURCE_NOT_FOUND" };

  const parsed = parseEnrollment(body);
  if (!parsed.ok) return { ok: false, code: "VALIDATION_FAILED", reason: parsed.reason };

  const id: Id<"payoutMethod"> = ctx.ids.next("payoutMethod");
  const now = ctx.clock.now();
  const record: PayoutMethodRecord = {
    id,
    publisherId,
    provider: parsed.provider,
    providerAccountRef: parsed.providerAccountRef,
    country: parsed.country,
    currency: parsed.currency,
    state: "active",
    verifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const outcome = await deps.store.insert({
    organizationId: scope.organizationId,
    record,
    audit: {
      id: ctx.ids.next("audit"),
      actor: { type: "user", id: principal.userId },
      action: "payout_method.enrolled",
      entityId: id,
      metadata: { publisherId, provider: parsed.provider },
      occurredAt: now,
    },
  });
  if (outcome === "unknown_publisher") return { ok: false, code: "RESOURCE_NOT_FOUND" };
  if (outcome === "duplicate") return { ok: false, code: "STATE_CONFLICT" };
  return { ok: true, value: toView(record) };
}

export async function listPayoutMethods(
  ctx: Ctx,
  deps: PayoutMethodDeps,
  principal: Principal,
  scope: Scope,
): Promise<ListPayoutMethodsResult> {
  const denied = authorize(ctx, principal, scope, "payouts:read");
  if (denied) return denied;
  const records = await deps.store.listForOrganization(scope.organizationId);
  return { ok: true, value: records.map(toView) };
}

// Disabling is one-way for a method. A method that is already disabled is returned as disabled and nothing is written.
export async function disablePayoutMethod(
  ctx: Ctx,
  deps: PayoutMethodDeps,
  principal: Principal,
  scope: Scope,
  id: string,
): Promise<DisablePayoutMethodResult> {
  const denied = authorize(ctx, principal, scope, "payouts:write");
  if (denied) return denied;
  const methodId = parseId("payoutMethod", id);
  if (methodId === null) return { ok: false, code: "RESOURCE_NOT_FOUND" };

  const at = ctx.clock.now();
  const outcome = await deps.store.disable({
    organizationId: scope.organizationId,
    id: methodId,
    at,
    audit: {
      id: ctx.ids.next("audit"),
      actor: { type: "user", id: principal.userId },
      action: "payout_method.disabled",
      entityId: methodId,
      metadata: {},
      occurredAt: at,
    },
  });
  if (outcome === "not_found") return { ok: false, code: "RESOURCE_NOT_FOUND" };
  return { ok: true, value: { id: methodId, state: "disabled" } };
}
