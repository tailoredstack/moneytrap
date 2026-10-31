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

  test("an explicit default port and an empty port are rejected, not normalised away", () => {
    expect(validateDestination("https://shop.example.com:443/", allowed)).toMatchObject({ reason: "port" });
    expect(validateDestination("https://shop.example.com:/", allowed)).toMatchObject({ reason: "port" });
  });

  test("empty userinfo is rejected, not normalised away", () => {
    expect(validateDestination("https://@shop.example.com/", allowed)).toMatchObject({ reason: "credentials" });
    expect(validateDestination("https://:@shop.example.com/", allowed)).toMatchObject({ reason: "credentials" });
  });

  test("credentials and ports are rejected when https: is not followed by //", () => {
    expect(validateDestination("https:user:pw@shop.example.com/", allowed)).toMatchObject({ reason: "credentials" });
    expect(validateDestination("https:\\\\user:pw@shop.example.com/", allowed)).toMatchObject({
      reason: "credentials",
    });
    expect(validateDestination("https:@shop.example.com/", allowed)).toMatchObject({ reason: "credentials" });
    expect(validateDestination("https:/shop.example.com:8443/", allowed)).toMatchObject({ reason: "port" });
    expect(validateDestination("https:shop.example.com:443/", allowed)).toMatchObject({ reason: "port" });
  });

  test("control characters are refused before parsing, so they cannot hide the authority", () => {
    expect(validateDestination("\x01https://user:pw@shop.example.com/", allowed)).toMatchObject({
      reason: "malformed",
    });
    expect(validateDestination("ht\ttps://shop.example.com:8443/", allowed)).toMatchObject({ reason: "malformed" });
    expect(validateDestination("https:\t/user:pw@shop.example.com/", allowed)).toMatchObject({ reason: "malformed" });
    expect(validateDestination("https:\n//user:pw@shop.example.com/", allowed)).toMatchObject({ reason: "malformed" });
    expect(validateDestination("https:\t//shop.example.com:8443/", allowed)).toMatchObject({ reason: "malformed" });
    expect(validateDestination("https://shop.example.com/\x7f", allowed)).toMatchObject({ reason: "malformed" });
  });

  test("an IPv6 literal is refused as a host, not as a port", () => {
    expect(validateDestination("https://[::1]/", allowed)).toEqual({
      ok: false,
      code: "VALIDATION_FAILED",
      reason: "host-not-allowed",
    });
    expect(validateDestination("https://[::1]:443/", allowed)).toMatchObject({ reason: "host-not-allowed" });
  });

  test("a trailing-dot host does not match the entry without the dot", () => {
    expect(validateDestination("https://shop.example.com./", allowed)).toMatchObject({ reason: "host-not-allowed" });
  });

  test("an IDN entry matches its punycode host, and an IDN host matches the same entry", () => {
    expect(validateDestination("https://xn--bcher-kva.example/", ["bücher.example"]).ok).toBe(true);
    expect(validateDestination("https://bücher.example/", ["xn--bcher-kva.example"]).ok).toBe(true);
  });

  test("a percent-encoded host resolves to the host a browser would use", () => {
    expect(validateDestination("https://shop%2Eexample%2Ecom/", allowed).ok).toBe(true);
  });

  test("a backslash ends the authority, as it does in a browser", () => {
    expect(validateDestination("https://shop.example.com\\@evil.example.net/", allowed)).toMatchObject({
      ok: true,
      value: { host: "shop.example.com" },
    });
    expect(validateDestination("https://evil.example.net\\shop.example.com/", allowed)).toMatchObject({
      reason: "host-not-allowed",
    });
  });

  test("an allow-list entry that is not a bare host matches nothing", () => {
    expect(validateDestination("https://shop.example.com/", ["shop.example.com/x"])).toMatchObject({
      reason: "host-not-allowed",
    });
    expect(validateDestination("https://evil.example.net/", ["evil.example.net@shop.example.com"])).toMatchObject({
      reason: "host-not-allowed",
    });
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
