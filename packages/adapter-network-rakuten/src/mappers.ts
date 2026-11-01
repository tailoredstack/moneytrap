import { createHash } from "node:crypto";
import type {
  AdvertiserRecord,
  ProgramApprovalState,
  ProgramRecord,
  TransactionRecord,
} from "@moneytrap/app/src/ports/network-connector";
import { exponentOf, isCurrencyCode, Money } from "@moneytrap/domain";

// Thrown by a mapper when the upstream sent something the port cannot represent. The connector turns it into a retryable
// failure and reports its kind. The message holds no upstream text.
export class MappingError extends Error {
  constructor(readonly kind: "malformed_body" | "unsupported_currency") {
    super(kind);
    this.name = "MappingError";
  }
}

export type Json = Record<string, unknown>;

export function asObject(value: unknown): Json {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new MappingError("malformed_body");
  return value as Json;
}

export function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new MappingError("malformed_body");
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new MappingError("malformed_body");
  return value;
}

// Rakuten IDs are integers in the JSON, and the transaction ID is a string. Both become the platform's source ID text.
export function sourceIdOf(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new MappingError("malformed_body");
}

// The revision is a digest of the mapped fields, because Rakuten sends no revision of its own. The same content always
// gives the same revision, and any change in a mapped field gives a new one.
export function revisionOf(fields: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 16);
}

export function toAdvertiser(raw: unknown): AdvertiserRecord {
  const row = asObject(raw);
  const name = text(row.name);
  return { sourceId: sourceIdOf(row.id), revision: revisionOf(["advertiser", name]), name };
}

// The network each advertiser belongs to, from the Partnerships API guide (network IDs 1, 3, 5, 7, 8, 9, 41).
const NETWORK_COUNTRY: Readonly<Record<number, string>> = {
  1: "US",
  3: "GB",
  5: "CA",
  7: "FR",
  8: "BR",
  9: "DE",
  41: "AU",
};

// Partnership status values from the Partnerships API guide. `extended` is not described there, so it is left unknown
// rather than read as approved.
const APPROVAL: Readonly<Record<string, ProgramApprovalState | null>> = {
  active: "approved",
  pending: "pending",
  "self-removed": "rejected",
  "permanent-decline": "rejected",
  "permanent-remove": "rejected",
  "temp-decline": "rejected",
  "temp-remove": "rejected",
  extended: null,
};

export function approvalOf(status: unknown): ProgramApprovalState | null {
  if (typeof status !== "string") throw new MappingError("malformed_body");
  return Object.hasOwn(APPROVAL, status) ? (APPROVAL[status] ?? null) : null;
}

export interface Partnership {
  advertiserSourceId: string;
  name: string;
  approval: ProgramApprovalState | null;
  countries: string[];
}

// GET /v1/partnerships/{advertiser-id}. The spec names the object `partnership` and the guide's example `partnerships`,
// so either is accepted.
export function toPartnership(body: unknown): Partnership {
  const root = asObject(body);
  const partnership = asObject(root.partnership ?? root.partnerships);
  const advertiser = asObject(partnership.advertiser);
  return {
    advertiserSourceId: sourceIdOf(advertiser.id),
    name: text(advertiser.name),
    approval: approvalOf(partnership.status),
    countries: countriesOf(advertiser.network),
  };
}

function countriesOf(network: unknown): string[] {
  const country = typeof network === "number" ? NETWORK_COUNTRY[network] : undefined;
  return country === undefined ? [] : [country];
}

// GET /v2/advertisers/{advertiser-id}, used when the publisher has no partnership with the advertiser. The advertiser
// exists and names its network, but the publisher has no approval with it.
export function toUnpartneredAdvertiser(body: unknown): Partnership {
  const advertiser = asObject(asObject(body).advertiser);
  return {
    advertiserSourceId: sourceIdOf(advertiser.id),
    name: text(advertiser.name),
    approval: null,
    countries: countriesOf(advertiser.network),
  };
}

// The terms text states each active offer: its name, type, terms link, and base commission. Offers are ordered by their
// ID so the text is stable between calls.
export function termsOf(offers: readonly unknown[]): string {
  const lines = offers
    .map((raw) => {
      const offer = asObject(raw);
      return { offer, id: offerId(offer) };
    })
    .sort((a, b) => a.id - b.id)
    .map(({ offer }) => {
      const parts = [`${text(offer.name)} (${text(offer.type)})`];
      if (typeof offer.terms_url === "string" && offer.terms_url !== "") parts.push(`terms: ${offer.terms_url}`);
      const commission = baseCommission(offer);
      if (commission !== "") parts.push(`commission: ${commission}`);
      return parts.join("; ");
    });
  return lines.join("\n");
}

// The group offer ID orders the offers. An offer with no integer ID cannot be placed, so the whole answer is refused.
function offerId(offer: Json): number {
  if (typeof offer.goid !== "number" || !Number.isSafeInteger(offer.goid)) throw new MappingError("malformed_body");
  return offer.goid;
}

function baseCommission(offer: Json): string {
  if (!Array.isArray(offer.offer_rules)) return "";
  const summaries: string[] = [];
  for (const rawRule of offer.offer_rules) {
    const rule = asObject(rawRule);
    if (rule.is_base_commission !== true || !Array.isArray(rule.commissions)) continue;
    for (const rawCommission of rule.commissions) {
      const commission = asObject(rawCommission);
      const tiers = Array.isArray(commission.tiers)
        ? commission.tiers.map((tier) => String(asObject(tier).commission)).join("/")
        : "";
      summaries.push(`${text(commission.commission_type)} ${tiers}`.trim());
    }
  }
  return summaries.join(", ");
}

export function toProgram(partnership: Partnership, terms: string): ProgramRecord {
  const { advertiserSourceId, name, approval, countries } = partnership;
  return {
    sourceId: advertiserSourceId,
    revision: revisionOf(["program", name, terms, approval, countries]),
    advertiserSourceId,
    name,
    terms,
    // The Rakuten APIs state no eligibility conditions and no channel list for a program. An empty channel list means
    // the eligibility policy denies every channel, which fails closed.
    eligibility: null,
    countries,
    channels: [],
    approval,
  };
}

// The Events API sends the amounts as decimal numbers. They become minor units through the currency's own exponent, so
// no float arithmetic reaches the ledger.
export function moneyOf(amount: unknown, currency: unknown): Money {
  if (typeof amount !== "number" || !Number.isFinite(amount) || Math.abs(amount) >= 1e15) {
    throw new MappingError("malformed_body");
  }
  if (typeof currency !== "string") throw new MappingError("malformed_body");
  // Rakuten also reports BRL, which the platform does not carry. A row in it cannot be represented, so it is never
  // dropped quietly.
  if (!isCurrencyCode(currency)) throw new MappingError("unsupported_currency");
  const exponent = exponentOf(currency);
  const fixed = amount.toFixed(exponent);
  // A value with more fraction digits than the currency has would be rounded by toFixed, which changes the money.
  if (Number(fixed) !== amount) throw new MappingError("malformed_body");
  return Money.of(BigInt(exponent === 0 ? fixed : fixed.replace(".", "")), currency);
}

// Events API dates look like "Tue Nov 03 2020 21:47:55 GMT+0000 (UTC)".
export function dateOf(value: unknown): Date {
  const at = new Date(text(value));
  if (Number.isNaN(at.getTime())) throw new MappingError("malformed_body");
  return at;
}

// The Events API sends no status field. A row is pending until it is locked: "Locked" is the documented lock_status of
// an order the advertiser can no longer change. A negative amount is read as a reversal.
function statusOf(row: Json, amount: Money, sale: unknown): TransactionRecord["status"] {
  if (amount.amount < 0n || (typeof sale === "number" && sale < 0)) return "reversed";
  return row.lock_status === "Locked" ? "approved" : "pending";
}

export function toTransaction(raw: unknown): TransactionRecord {
  const row = asObject(raw);
  const amount = moneyOf(row.commissions, row.currency);
  const occurredAt = dateOf(row.transaction_date);
  const status = statusOf(row, amount, row.sale_amount);
  const subId = typeof row.u1 === "string" && row.u1 !== "" ? row.u1 : null;
  return {
    sourceId: sourceIdOf(row.etransaction_id),
    revision: revisionOf(["transaction", status, amount.amount.toString(), amount.currency, row.process_date ?? null]),
    status,
    amount,
    occurredAt,
    subId,
  };
}
