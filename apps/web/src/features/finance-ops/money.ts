// A money amount as the API returns it: minor units as a bigint, the currency code, and the number of minor-unit digits
// (2 for USD, 0 for JPY, 3 for BHD). The screens never convert through floating point.
export interface Money {
  minor: bigint;
  currency: string;
  exponent: number;
}

// An amount the source cannot vouch for is null. It renders as a dash, never as zero (SKELETONS §6.1, §8).
export function formatMoney(money: Money | null): string {
  if (money === null) return "—";
  const negative = money.minor < 0n;
  const digits = (negative ? -money.minor : money.minor).toString().padStart(money.exponent + 1, "0");
  const whole = digits.slice(0, digits.length - money.exponent).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = digits.slice(digits.length - money.exponent);
  const amount = money.exponent === 0 ? whole : `${whole}.${fraction}`;
  return `${money.currency} ${negative ? "-" : ""}${amount}`;
}
