import { exponentOf, isCurrencyCode } from "./currency";
import type { CurrencyCode } from "./iso4217";

// Thrown when a money operation breaks a rule the caller must fix.
export class MoneyError extends Error {
  readonly code = "VALIDATION_FAILED";
  constructor(message: string) {
    super(`VALIDATION_FAILED: ${message}`);
    this.name = "MoneyError";
  }
}

// Money is an integer count of minor units in one currency. No float path exists.
export class Money {
  private constructor(
    readonly amount: bigint,
    readonly currency: CurrencyCode,
  ) {}

  static of(amount: bigint, currency: CurrencyCode): Money {
    return new Money(amount, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }

  format(): string {
    const digits = exponentOf(this.currency);
    const negative = this.amount < 0n;
    const abs = (negative ? -this.amount : this.amount).toString().padStart(digits + 1, "0");
    const whole = digits === 0 ? abs : abs.slice(0, -digits);
    const fraction = digits === 0 ? "" : `.${abs.slice(-digits)}`;
    return `${negative ? "-" : ""}${whole}${fraction}`;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new MoneyError(`cannot combine ${this.currency} with ${other.currency}`);
    }
  }
}

export type ParseResult = { ok: true; value: Money } | { ok: false; error: MoneyError };

// Accepts only decimal strings with at most the currency's exponent of fraction digits.
const decimalRe = /^(-)?(0|[1-9]\d*)(?:\.(\d+))?$/;

export function parseMoney(input: unknown, currency: string): ParseResult {
  if (typeof input !== "string") {
    return { ok: false, error: new MoneyError("amount must be a decimal string") };
  }
  if (!isCurrencyCode(currency)) {
    return { ok: false, error: new MoneyError(`unknown currency ${currency}`) };
  }
  const match = decimalRe.exec(input);
  if (!match) {
    return { ok: false, error: new MoneyError(`invalid amount ${input}`) };
  }
  const [, sign, whole, fraction = ""] = match;
  const digits = exponentOf(currency);
  if (fraction.length > digits) {
    return { ok: false, error: new MoneyError(`${currency} allows ${digits} fraction digits`) };
  }
  const minor = BigInt(`${whole}${fraction.padEnd(digits, "0")}`);
  return { ok: true, value: Money.of(sign ? -minor : minor, currency) };
}
