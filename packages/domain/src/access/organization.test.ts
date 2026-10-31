import { describe, expect, test } from "bun:test";
import { parseOrganizationInput } from "./organization";

const valid = { name: "  Acme Media  ", country: "ES", base_currency: "EUR" };

describe("parseOrganizationInput", () => {
  test("accepts a complete body and trims the name", () => {
    expect(parseOrganizationInput(valid)).toEqual({
      ok: true,
      value: { name: "Acme Media", country: "ES", baseCurrency: "EUR" },
    });
  });

  test("rejects a blank or overlong name", () => {
    expect(parseOrganizationInput({ ...valid, name: " " }).ok).toBe(false);
    expect(parseOrganizationInput({ ...valid, name: "x".repeat(121) }).ok).toBe(false);
  });

  test("rejects a country that is not two uppercase letters", () => {
    expect(parseOrganizationInput({ ...valid, country: "es" }).ok).toBe(false);
    expect(parseOrganizationInput({ ...valid, country: "ESP" }).ok).toBe(false);
  });

  test("rejects a currency that is not in the ISO 4217 table", () => {
    expect(parseOrganizationInput({ ...valid, base_currency: "XXX-NOPE" }).ok).toBe(false);
    expect(parseOrganizationInput({ ...valid, base_currency: "constructor" }).ok).toBe(false);
  });

  test("rejects a non-object body", () => {
    expect(parseOrganizationInput(null).ok).toBe(false);
    expect(parseOrganizationInput("Acme").ok).toBe(false);
  });
});
