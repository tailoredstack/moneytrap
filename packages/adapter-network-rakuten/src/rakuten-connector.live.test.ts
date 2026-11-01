import { describe, expect, test } from "bun:test";
import { FakeClock } from "@moneytrap/test-kit";
import { RakutenConnector } from "./rakuten-connector";

// A smoke test against the real Rakuten API. It runs only when RAKUTEN_CLIENT_ID, RAKUTEN_CLIENT_SECRET, and
// RAKUTEN_ACCOUNT_ID are all set in the environment, so CI and a fresh checkout skip it. It reads only, and it prints
// no response data.
const { RAKUTEN_CLIENT_ID, RAKUTEN_CLIENT_SECRET, RAKUTEN_ACCOUNT_ID, RAKUTEN_API_BASE_URL } = process.env;
const configured = Boolean(RAKUTEN_CLIENT_ID && RAKUTEN_CLIENT_SECRET && RAKUTEN_ACCOUNT_ID);

describe.skipIf(!configured)("Rakuten Advertising live API", () => {
  const connector = () =>
    new RakutenConnector({
      clientId: RAKUTEN_CLIENT_ID ?? "",
      clientSecret: RAKUTEN_CLIENT_SECRET ?? "",
      accountId: RAKUTEN_ACCOUNT_ID ?? "",
      clock: { now: () => new Date() },
      ...(RAKUTEN_API_BASE_URL ? { baseUrl: RAKUTEN_API_BASE_URL } : {}),
      pageSize: 5,
    });

  test("the credential is accepted and the token exchange succeeds", async () => {
    const result = await connector().validateConnection();

    expect(result.ok).toBe(true);
  });

  test("advertisers are listed with Rakuten IDs", async () => {
    const result = await connector().discoverAdvertisers({ cursor: null });

    expect(result.ok && result.value.items.every((item) => /^\d+$/.test(item.sourceId))).toBe(true);
  });

  test("the last seven days of transactions can be read", async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86_400_000);

    const result = await connector().listTransactions({ from, to, cursor: null });

    expect(result.ok).toBe(true);
  });
});
