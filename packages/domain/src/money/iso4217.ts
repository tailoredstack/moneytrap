// Minor-unit exponents for the ISO 4217 codes the platform accepts.
export const ISO_4217_EXPONENTS = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  JPY: 0,
  KRW: 0,
  BHD: 3,
} as const;

export type CurrencyCode = keyof typeof ISO_4217_EXPONENTS;
