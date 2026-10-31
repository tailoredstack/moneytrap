import { type CurrencyCode, ISO_4217_EXPONENTS } from "../money/iso4217";

export const ORGANIZATION_STATUSES = ["active", "suspended", "closed"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export interface OrganizationInput {
  name: string;
  country: string;
  baseCurrency: CurrencyCode;
}

export type OrganizationInputResult = { ok: true; value: OrganizationInput } | { ok: false; reason: string };

const NAME_MAX = 120;
const COUNTRY_RE = /^[A-Z]{2}$/;

// Checks the caller's fields (spec API-015: name, country, base_currency). Unknown fields are not read,
// so a client cannot set the owner or creator through this input.
export function parseOrganizationInput(raw: unknown): OrganizationInputResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "body must be an object" };
  const { name, country, base_currency: baseCurrency } = raw as Record<string, unknown>;

  if (typeof name !== "string" || name.trim() === "" || name.trim().length > NAME_MAX) {
    return { ok: false, reason: `name must be 1 to ${NAME_MAX} characters` };
  }
  if (typeof country !== "string" || !COUNTRY_RE.test(country)) {
    return { ok: false, reason: "country must be an ISO 3166-1 alpha-2 code" };
  }
  if (typeof baseCurrency !== "string" || !Object.hasOwn(ISO_4217_EXPONENTS, baseCurrency)) {
    return { ok: false, reason: "base_currency must be an ISO 4217 code" };
  }
  return { ok: true, value: { name: name.trim(), country, baseCurrency: baseCurrency as CurrencyCode } };
}
