import { describe, expect, test } from "bun:test";
import { CONNECTOR_OPERATIONS } from "@moneytrap/domain";
import { FakeClock } from "@moneytrap/test-kit";
import type { Diagnostic, FetchLike } from "./client";
import { createFakeRakuten, FAKE_ACCOUNT_ID, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, type FakeMode } from "./fake-rakuten";
import { RAKUTEN_CAPABILITIES, RakutenConnector } from "./rakuten-connector";

const NOW = "2026-11-01T00:00:00.000Z";
const range = { from: new Date("2026-10-15T00:00:00.000Z"), to: new Date("2026-11-01T00:00:00.000Z") };

function setup(
  options: { mode?: FakeMode; pageSize?: number; tokenTtlSeconds?: number; wrap?: (f: FetchLike) => FetchLike } = {},
) {
  const clock = new FakeClock(NOW);
  const upstream = createFakeRakuten({
    now: () => clock.now(),
    pageSize: options.pageSize ?? 2,
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.tokenTtlSeconds ? { tokenTtlSeconds: options.tokenTtlSeconds } : {}),
  });
  const diagnostics: Diagnostic[] = [];
  const connector = new RakutenConnector({
    clientId: FAKE_CLIENT_ID,
    clientSecret: FAKE_CLIENT_SECRET,
    accountId: FAKE_ACCOUNT_ID,
    clock,
    fetch: options.wrap ? options.wrap(upstream.fetch) : upstream.fetch,
    pageSize: options.pageSize ?? 2,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { connector, upstream, clock, diagnostics };
}

describe("RakutenConnector access token (Rakuten access-token guide)", () => {
  test("requests a token with POST /token, the base64 client credential as Bearer, and the account ID as scope", async () => {
    const urls: string[] = [];
    const { connector, upstream } = setup({
      wrap: (inner) => (url, init) => {
        urls.push(url);
        return inner(url, init);
      },
    });

    await connector.discoverAdvertisers({ cursor: null });

    const token = upstream.requests.find((request) => request.path === "/token");
    expect(token?.method).toBe("POST");
    expect(token?.authorization).toBe(
      `Bearer ${Buffer.from(`${FAKE_CLIENT_ID}:${FAKE_CLIENT_SECRET}`).toString("base64")}`,
    );
    expect(token?.body).toBe(`scope=${FAKE_ACCOUNT_ID}`);
    expect(urls[0]).toBe("https://api.linksynergy.com/token");
  });

  test("one token serves later calls, and concurrent first calls share one token request", async () => {
    const { connector, upstream } = setup();

    await Promise.all([
      connector.discoverAdvertisers({ cursor: null }),
      connector.discoverAdvertisers({ cursor: null }),
    ]);
    await connector.discoverAdvertisers({ cursor: null });

    expect(upstream.state.tokenCalls).toBe(1);
  });

  test("a token near its end of life is replaced before the next call", async () => {
    const { connector, upstream, clock } = setup({ tokenTtlSeconds: 3600 });
    await connector.discoverAdvertisers({ cursor: null });

    clock.advance({ minutes: 59, seconds: 30 });
    await connector.discoverAdvertisers({ cursor: null });

    expect(upstream.state.tokenCalls).toBe(2);
  });

  test("a 401 from the API replaces the token once and retries", async () => {
    const { connector, upstream } = setup();
    await connector.discoverAdvertisers({ cursor: null });
    upstream.state.validTokens.clear();

    const result = await connector.discoverAdvertisers({ cursor: null });

    expect(result.ok).toBe(true);
    expect(upstream.state.tokenCalls).toBe(2);
  });

  test("a 401 that survives a new token is not_authorized", async () => {
    const { connector } = setup({
      wrap: (inner) => async (url, init) => {
        const response = await inner(url, init);
        return new URL(url).pathname === "/v2/advertisers" ? new Response("{}", { status: 401 }) : response;
      },
    });

    expect(await connector.discoverAdvertisers({ cursor: null })).toEqual({
      ok: false,
      failure: { state: "not_authorized" },
    });
  });

  test("a refused client credential is not_authorized and nothing from the 401 body is returned", async () => {
    const { connector } = setup({ mode: "disabled-credential" });

    const result = await connector.discoverAdvertisers({ cursor: null });

    expect(result).toEqual({ ok: false, failure: { state: "not_authorized" } });
    expect(JSON.stringify(result)).not.toContain(
      Buffer.from(`${FAKE_CLIENT_ID}:${FAKE_CLIENT_SECRET}`).toString("base64"),
    );
  });
});

describe("RakutenConnector upstream failures", () => {
  test("403 is Rakuten's documented rate limit, so it is temporarily_unavailable with a retry-after", async () => {
    const { connector } = setup({
      wrap: (inner) => async (url, init) =>
        new URL(url).pathname === "/token" ? inner(url, init) : new Response("{}", { status: 403 }),
    });

    expect(await connector.discoverAdvertisers({ cursor: null })).toEqual({
      ok: false,
      failure: { state: "temporarily_unavailable", retryAfterSeconds: 60 },
    });
  });

  test("a Retry-After header on 429 is passed on as seconds", async () => {
    const { connector } = setup({
      wrap: (inner) => async (url, init) =>
        new URL(url).pathname === "/token"
          ? inner(url, init)
          : new Response("{}", { status: 429, headers: { "retry-after": "17" } }),
    });

    expect(await connector.discoverAdvertisers({ cursor: null })).toEqual({
      ok: false,
      failure: { state: "temporarily_unavailable", retryAfterSeconds: 17 },
    });
  });

  test("a network error is temporarily_unavailable and the diagnostic carries no text from the error", async () => {
    const { connector, diagnostics } = setup({
      wrap: () => async () => {
        throw new Error(`connect failed for Bearer ${FAKE_CLIENT_SECRET}`);
      },
    });

    const result = await connector.discoverAdvertisers({ cursor: null });

    expect(result).toEqual({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: null } });
    expect(diagnostics).toEqual([{ operation: "discover_advertisers", kind: "network_error" }]);
    expect(JSON.stringify(diagnostics)).not.toContain(FAKE_CLIENT_SECRET);
  });

  test("a body that is not the documented shape is a retryable failure, never an empty page", async () => {
    const { connector, diagnostics } = setup({
      wrap: (inner) => async (url, init) =>
        new URL(url).pathname === "/v2/advertisers"
          ? new Response(JSON.stringify({ advertisers: "none" }), { status: 200 })
          : inner(url, init),
    });

    expect(await connector.discoverAdvertisers({ cursor: null })).toEqual({
      ok: false,
      failure: { state: "temporarily_unavailable", retryAfterSeconds: null },
    });
    expect(diagnostics).toEqual([{ operation: "discover_advertisers", kind: "malformed_body" }]);
  });

  test("a next link that does not move forward is refused instead of looping", async () => {
    const { connector } = setup({
      wrap: () => async (url) =>
        new URL(url).pathname === "/token"
          ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 })
          : new Response(
              JSON.stringify({
                _metadata: { page: 3, _links: { next: "/v2/advertisers?page=3" } },
                advertisers: [],
              }),
              { status: 200 },
            ),
    });

    const result = await connector.discoverAdvertisers({ cursor: null });

    expect(result.ok).toBe(false);
  });
});

describe("RakutenConnector capabilities", () => {
  test("adjustments, settlement evidence, and notifications are unsupported and make no request", async () => {
    const { connector, upstream } = setup();

    expect(await connector.listAdjustments({ ...range, cursor: null })).toEqual({
      ok: false,
      failure: { state: "unsupported" },
    });
    expect(await connector.retrieveSettlementEvidence({ ...range, cursor: null })).toEqual({
      ok: false,
      failure: { state: "unsupported" },
    });
    expect(await connector.receiveNotification({ headers: {}, body: "{}" })).toEqual({
      ok: false,
      failure: { state: "unsupported" },
    });
    expect(upstream.requests).toEqual([]);
  });

  test("validate_connection reports the static profile and the account scope", async () => {
    const { connector } = setup();

    const result = await connector.validateConnection();

    expect(result.ok && result.value.capabilities).toEqual(RAKUTEN_CAPABILITIES);
    expect(result.ok && result.value.permittedScopes).toEqual([`account:${FAKE_ACCOUNT_ID}`]);
    expect(Object.keys(RAKUTEN_CAPABILITIES).sort()).toEqual([...CONNECTOR_OPERATIONS].sort());
  });
});

describe("RakutenConnector catalog", () => {
  test("advertisers follow the upstream next link and are identified by Rakuten's ID", async () => {
    const { connector, upstream } = setup();

    const first = await connector.discoverAdvertisers({ cursor: null });
    const second = await connector.discoverAdvertisers({ cursor: first.ok ? first.value.nextCursor : null });

    expect(first.ok && first.value.items.map((item) => [item.sourceId, item.name])).toEqual([
      ["100", "Northwind Outdoor"],
      ["200", "Harbor Books"],
    ]);
    expect(second.ok && second.value.items.map((item) => item.sourceId)).toEqual(["300"]);
    expect(second.ok && second.value.nextCursor).toBeNull();
    const pages = upstream.requests.filter((r) => r.path === "/v2/advertisers").map((r) => r.query.get("page"));
    expect(pages).toEqual([null, "1"]);
  });

  test("an advertiser's revision changes only when a mapped field changes", async () => {
    const a = await setup().connector.discoverAdvertisers({ cursor: null });
    const b = await setup().connector.discoverAdvertisers({ cursor: null });

    expect(a.ok && a.value.items[0]?.revision).toBe(b.ok && b.value.items[0]?.revision);
    expect(a.ok && a.value.items[0]?.revision).not.toBe(a.ok && a.value.items[1]?.revision);
  });

  test("an active partnership is an approved program with the offer terms and the network's country", async () => {
    const { connector } = setup();

    const result = await connector.discoverPrograms({ advertiserSourceId: "100", cursor: null });

    const program = result.ok ? result.value.items[0] : undefined;
    expect(program).toMatchObject({
      sourceId: "100",
      advertiserSourceId: "100",
      name: "Northwind Outdoor",
      approval: "approved",
      countries: ["US"],
      eligibility: null,
      // Rakuten publishes no channel list, so none is claimed.
      channels: [],
    });
    expect(program?.terms).toContain("Standard commission (public)");
    expect(program?.terms).toContain("terms: https://northwind.example.test/terms");
    expect(program?.terms).toContain("commission: percent 8");
  });

  test("a pending partnership is pending, and its terms are not read", async () => {
    const { connector, upstream } = setup();

    const result = await connector.discoverPrograms({ advertiserSourceId: "200", cursor: null });

    expect(result.ok && result.value.items[0]?.approval).toBe("pending");
    expect(result.ok && result.value.items[0]?.terms).toBe("");
    expect(upstream.requests.some((request) => request.path === "/v1/offers")).toBe(false);
  });

  test("an advertiser with no partnership is reported with no approval, never as approved", async () => {
    const { connector } = setup();

    const result = await connector.discoverPrograms({ advertiserSourceId: "300", cursor: null });

    expect(result.ok && result.value.items[0]).toMatchObject({ sourceId: "300", approval: null, countries: [] });
  });

  test("an unknown partnership status is left unknown instead of being read as approved", async () => {
    const { connector } = setup({
      wrap: (inner) => async (url, init) => {
        const response = await inner(url, init);
        if (!new URL(url).pathname.startsWith("/v1/partnerships/")) return response;
        const body = (await response.json()) as { partnership: { status: string } };
        body.partnership.status = "extended";
        return new Response(JSON.stringify(body), { status: 200 });
      },
    });

    const result = await connector.discoverPrograms({ advertiserSourceId: "100", cursor: null });

    expect(result.ok && result.value.items[0]?.approval).toBeNull();
  });

  test("a program's revision changes when its terms change", async () => {
    const before = await setup().connector.discoverPrograms({ advertiserSourceId: "100", cursor: null });
    const changed = setup({
      wrap: (inner) => async (url, init) => {
        const response = await inner(url, init);
        if (new URL(url).pathname !== "/v1/offers") return response;
        const body = (await response.json()) as { offers: Array<{ name: string }> };
        for (const offer of body.offers) offer.name = "Renegotiated commission";
        return new Response(JSON.stringify(body), { status: 200 });
      },
    });
    const after = await changed.connector.discoverPrograms({ advertiserSourceId: "100", cursor: null });

    expect(before.ok && after.ok && before.value.items[0]?.revision).not.toBe(
      after.ok && after.value.items[0]?.revision,
    );
  });
});

describe("RakutenConnector tracking links (POST /v1/links/deep_links)", () => {
  const request = {
    propertyId: "prop_1" as never,
    programSourceId: "100",
    destinationUrl: "https://northwind.example.test/boots",
    subId: "click-77",
  };

  test("creates the link for the advertiser with the sub-ID as u1", async () => {
    const { connector, upstream } = setup();

    const result = await connector.resolveTrackingDestination(request);

    expect(result.ok && result.value.subId).toBe("click-77");
    expect(result.ok && new URL(result.value.url).searchParams.get("u1")).toBe("click-77");
    const post = upstream.requests.find((r) => r.path === "/v1/links/deep_links");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      url: "https://northwind.example.test/boots",
      advertiser_id: 100,
      u1: "click-77",
    });
  });

  test("no link is requested for an advertiser the publisher is not approved with", async () => {
    const { connector, upstream } = setup();

    for (const programSourceId of ["200", "300", "999", "not-a-number"]) {
      expect(await connector.resolveTrackingDestination({ ...request, programSourceId })).toEqual({
        ok: false,
        failure: { state: "not_authorized" },
      });
    }
    expect(upstream.requests.some((r) => r.path === "/v1/links/deep_links")).toBe(false);
  });

  test("a link that does not carry the sub-ID is not returned", async () => {
    const { connector } = setup({
      wrap: (inner) => async (url, init) => {
        const response = await inner(url, init);
        if (new URL(url).pathname !== "/v1/links/deep_links") return response;
        const body = (await response.json()) as { advertiser: { deep_link: { u1: string } } };
        body.advertiser.deep_link.u1 = "someone-else";
        return new Response(JSON.stringify(body), { status: 200 });
      },
    });

    const result = await connector.resolveTrackingDestination(request);

    expect(result).toEqual({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: null } });
  });
});

describe("RakutenConnector transactions (Events API)", () => {
  async function allRows(connector: RakutenConnector, input = range) {
    const items = [];
    let cursor: string | null = null;
    do {
      const result = await connector.listTransactions({ ...input, cursor });
      if (!result.ok) throw new Error(JSON.stringify(result.failure));
      items.push(...result.value.items);
      cursor = result.value.nextCursor;
    } while (cursor !== null);
    return items;
  }

  test("amounts are commissions in minor units, with a status and the click sub-ID", async () => {
    const rows = await allRows(setup().connector);

    expect(rows.map((row) => [row.sourceId, row.amount.amount, row.amount.currency, row.status, row.subId])).toEqual([
      ["TX-1", 1250n, "USD", "pending", "click-a"],
      ["TX-2", 420n, "USD", "pending", null],
      ["TX-3", -250n, "USD", "reversed", null],
      ["TX-4", 999n, "USD", "approved", "click-b"],
    ]);
    expect(rows[0]?.occurredAt).toEqual(new Date("2026-10-22T00:00:00.000Z"));
  });

  test("a range longer than 30 days is read as several windows and returns every row once", async () => {
    const { connector, upstream } = setup();
    const long = { from: new Date("2026-08-15T00:00:00.000Z"), to: new Date("2026-11-01T00:00:00.000Z") };

    const rows = await allRows(connector, long);

    expect(rows.map((row) => row.sourceId)).toEqual(["TX-1", "TX-2", "TX-3", "TX-4"]);
    const windows = upstream.requests.filter((r) => r.path === "/events/1.0/transactions");
    expect(new Set(windows.map((r) => r.query.get("transaction_date_start"))).size).toBeGreaterThan(2);
  });

  test("windows do not overlap and the last one ends before the range end", async () => {
    const { connector, upstream } = setup();
    await allRows(connector, { from: new Date("2026-09-01T00:00:00.000Z"), to: new Date("2026-11-01T00:00:00.000Z") });

    const ends = upstream.requests
      .filter((r) => r.path === "/events/1.0/transactions")
      .map((r) => r.query.get("transaction_date_end"));
    expect(ends.at(-1)).toBe("2026-10-31 23:59:59");
  });

  test("a range that starts more than 100 days back is unsupported rather than answered in part", async () => {
    const { connector, upstream } = setup();

    const result = await connector.listTransactions({
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-11-01T00:00:00.000Z"),
      cursor: null,
    });

    expect(result).toEqual({ ok: false, failure: { state: "unsupported" } });
    expect(upstream.requests).toEqual([]);
  });

  test("a row in a currency the platform does not carry fails the page instead of being dropped", async () => {
    const { connector, diagnostics } = setup({
      wrap: (inner) => async (url, init) => {
        const response = await inner(url, init);
        if (new URL(url).pathname !== "/events/1.0/transactions") return response;
        const rows = (await response.json()) as Array<{ currency: string }>;
        if (rows[0]) rows[0].currency = "BRL";
        return new Response(JSON.stringify(rows), { status: 200 });
      },
    });

    const result = await connector.listTransactions({ ...range, cursor: null });

    expect(result).toEqual({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: null } });
    expect(diagnostics).toEqual([{ operation: "list_transactions", kind: "unsupported_currency" }]);
  });

  test("a cursor for a different range is refused", async () => {
    const { connector } = setup();
    const first = await connector.listTransactions({ ...range, cursor: null });
    const cursor = first.ok ? first.value.nextCursor : null;

    await expect(
      connector.listTransactions({ from: range.from, to: new Date("2026-10-31T00:00:00.000Z"), cursor }),
    ).rejects.toThrow("cursor was not issued for this query");
  });
});

describe("RakutenConnector configuration", () => {
  const base = { clock: new FakeClock(NOW), accountId: FAKE_ACCOUNT_ID };

  test("a missing credential field is refused by name, and the message holds no credential value", () => {
    const build = () => new RakutenConnector({ ...base, clientId: FAKE_CLIENT_ID, clientSecret: "  " });

    expect(build).toThrow("clientSecret is required");
    try {
      build();
    } catch (error) {
      expect(String(error)).not.toContain(FAKE_CLIENT_ID);
    }
  });

  test("a page size outside Rakuten's 1 to 200 is refused", () => {
    for (const pageSize of [0, 201, 1.5]) {
      expect(() => new RakutenConnector({ ...base, clientId: "a", clientSecret: "b", pageSize })).toThrow("pageSize");
    }
  });
});
