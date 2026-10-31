import { type Money, MoneyError, type ParseResult, parseMoney } from "@moneytrap/domain";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// §7.2: an amount crosses the API as an exact decimal string plus an ISO 4217 code.
export const MoneySchema = Type.Object(
  {
    amount: Type.String({
      pattern: "^-?(0|[1-9]\\d*)(\\.\\d+)?$",
      description: "Exact decimal amount in the currency's major unit",
    }),
    currency: Type.String({ pattern: "^[A-Z]{3}$", description: "ISO 4217 currency code" }),
  },
  { $id: "Money", additionalProperties: false },
);

export type MoneyDto = Static<typeof MoneySchema>;

// The one formatter for money on the wire (ADR-005). Never use parseFloat or Number here.
export function encodeMoney(money: Money): MoneyDto {
  return { amount: money.format(), currency: money.currency };
}

export function decodeMoney(input: unknown): ParseResult {
  if (!Value.Check(MoneySchema, input)) {
    return { ok: false, error: new MoneyError("money must be an object with amount and currency") };
  }
  return parseMoney(input.amount, input.currency);
}
