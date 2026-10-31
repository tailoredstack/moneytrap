import { describe, expect, test } from "bun:test";
import { validateDestination } from "./destination";

const allowed = ["shop.example.com"];

describe("destination allow-list", () => {
  test("TP-W5-004 an https URL on an allowed host passes", () => {
    const result = validateDestination("https://shop.example.com/item?id=1", allowed);
    expect(result).toEqual({
      ok: true,
      value: { url: "https://shop.example.com/item?id=1", host: "shop.example.com" },
    });
  });

  test("TP-W5-004 a host not on the allow-list is rejected", () => {
    expect(validateDestination("https://evil.example.net/", allowed)).toEqual({
      ok: false,
      code: "VALIDATION_FAILED",
      reason: "host-not-allowed",
    });
  });

  test("subdomains and lookalike hosts need their own entry", () => {
    expect(validateDestination("https://a.shop.example.com/", allowed)).toMatchObject({ reason: "host-not-allowed" });
    expect(validateDestination("https://shop.example.com.evil.net/", allowed)).toMatchObject({
      reason: "host-not-allowed",
    });
  });

  test("the allow-list is matched case-insensitively", () => {
    expect(validateDestination("https://SHOP.example.com/", ["Shop.Example.COM"]).ok).toBe(true);
  });

  test("TP-W5-003 javascript: and other non-https schemes are rejected", () => {
    expect(validateDestination("javascript:alert(1)", allowed)).toMatchObject({ reason: "scheme" });
    expect(validateDestination("http://shop.example.com/", allowed)).toMatchObject({ reason: "scheme" });
    expect(validateDestination("data:text/html,hi", allowed)).toMatchObject({ reason: "scheme" });
  });

  test("userinfo and explicit ports are rejected", () => {
    expect(validateDestination("https://user:pw@shop.example.com/", allowed)).toMatchObject({ reason: "credentials" });
    expect(validateDestination("https://shop.example.com:8443/", allowed)).toMatchObject({ reason: "port" });
  });

  test("an unparseable URL is malformed", () => {
    expect(validateDestination("not a url", allowed)).toEqual({
      ok: false,
      code: "VALIDATION_FAILED",
      reason: "malformed",
    });
  });

  test("an empty allow-list rejects every destination", () => {
    expect(validateDestination("https://shop.example.com/", [])).toMatchObject({ reason: "host-not-allowed" });
  });
});
