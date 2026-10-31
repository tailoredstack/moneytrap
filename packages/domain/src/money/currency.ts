import { type CurrencyCode, ISO_4217_EXPONENTS } from "./iso4217";

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(ISO_4217_EXPONENTS, value);
}

export function exponentOf(currency: CurrencyCode): number {
  return ISO_4217_EXPONENTS[currency];
}
