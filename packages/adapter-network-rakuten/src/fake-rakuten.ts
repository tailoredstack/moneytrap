import type { FetchLike } from "./client";

// A stand-in for api.linksynergy.com, built from the shapes in Rakuten's published API specification and access-token
// guide. It enforces the documented limits (token auth, 30-day Events ranges, 100-day Events history) so a test fails
// the way the real API would. It is test support, not a recording of real traffic.

export const FAKE_CLIENT_ID = "test-client-id-0001";
export const FAKE_CLIENT_SECRET = "test-client-secret-SENTINEL-7f3a";
export const FAKE_ACCOUNT_ID = "4242";
export const FAKE_TOKEN_KEY = Buffer.from(`${FAKE_CLIENT_ID}:${FAKE_CLIENT_SECRET}`, "utf8").toString("base64");

export type FakeMode = "healthy" | "disabled-credential" | "upstream-unavailable";

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  authorization: string | null;
  body: string | null;
}

export interface FakeRakutenOptions {
  mode?: FakeMode;
  now: () => Date;
  pageSize?: number;
  // Seconds the fake says each access token lasts.
  tokenTtlSeconds?: number;
  webSecurityToken?: string;
}

const DAY = 86_400_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const two = (n: number) => String(n).padStart(2, "0");

// "Tue Nov 03 2020 21:47:55 GMT+0000 (UTC)", the Events API date format.
export function eventsStyleDate(at: Date): string {
  const date = `${DAYS[at.getUTCDay()]} ${MONTHS[at.getUTCMonth()]} ${two(at.getUTCDate())} ${at.getUTCFullYear()}`;
  return `${date} ${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())} GMT+0000 (UTC)`;
}

export const ADVERTISERS = [
  { id: 100, name: "Northwind Outdoor" },
  { id: 200, name: "Harbor Books" },
  { id: 300, name: "Cedar Kitchens" },
];

const PARTNERSHIPS: Record<number, { status: string; network: number }> = {
  100: { status: "active", network: 1 },
  200: { status: "pending", network: 1 },
};

const OFFERS = [
  {
    goid: 11,
    name: "Standard commission",
    type: "public",
    terms_url: "https://northwind.example.test/terms",
    offer_rules: [
      { is_base_commission: true, commissions: [{ commission_type: "percent", tiers: [{ commission: 8 }] }] },
    ],
  },
];

// Seconds-from-now offsets chosen so every row sits well inside the 100-day history.
export function transactionRows(now: Date) {
  const at = (days: number) => new Date(now.getTime() - days * DAY);
  const row = (id: string, days: number, commissions: number, extra: Record<string, unknown> = {}) => ({
    etransaction_id: id,
    advertiser_id: 100,
    sid: 4242,
    order_id: `order-${id}`,
    sale_amount: commissions * 10,
    quantity: 1,
    commissions,
    process_date: eventsStyleDate(new Date(at(days).getTime() + 3_600_000)),
    transaction_date: eventsStyleDate(at(days)),
    transaction_type: "realtime",
    currency: "USD",
    is_event: false,
    lock_status: "#N/A",
    u1: "",
    ...extra,
  });
  return [
    row("TX-1", 10, 12.5, { u1: "click-a" }),
    row("TX-2", 8, 4.2),
    row("TX-3", 6, -2.5, { lock_status: "#N/A" }),
    row("TX-4", 4, 9.99, { lock_status: "Locked", u1: "click-b" }),
  ];
}

export function createFakeRakuten(options: FakeRakutenOptions) {
  const mode = options.mode ?? "healthy";
  const pageSize = options.pageSize ?? 2;
  const ttl = options.tokenTtlSeconds ?? 3600;
  const requests: FakeRequest[] = [];
  const state = { issued: 0, validTokens: new Set<string>(), tokenCalls: 0 };
  const expectedKey = FAKE_TOKEN_KEY;

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", date: options.now().toUTCString(), ...headers },
    });

  const handler: FetchLike = async (url, init) => {
    const parsed = new URL(url);
    const authorization = new Headers(init.headers).get("authorization");
    const body = typeof init.body === "string" ? init.body : null;
    requests.push({
      method: init.method ?? "GET",
      path: parsed.pathname,
      query: parsed.searchParams,
      authorization,
      body,
    });

    if (mode === "upstream-unavailable") return json(503, { error: "unavailable" });

    if (parsed.pathname === "/token") {
      state.tokenCalls += 1;
      const params = new URLSearchParams(body ?? "");
      if (mode === "disabled-credential" || authorization !== `Bearer ${expectedKey}`) {
        return json(401, { error: "invalid_client", detail: `bad key ${authorization ?? ""}` });
      }
      if (params.get("scope") !== FAKE_ACCOUNT_ID) return json(400, { error: "invalid_scope" });
      state.issued += 1;
      const token = `access-token-${state.issued}`;
      state.validTokens.add(token);
      return json(200, { access_token: token, expires_in: ttl, refresh_token: "refresh", token_type: "bearer" });
    }

    const token = authorization?.replace(/^Bearer /, "") ?? "";
    if (!state.validTokens.has(token)) return json(401, { error: "Access Token Expired" });

    const path = parsed.pathname;
    const query = parsed.searchParams;
    const ok = (payload: unknown) => json(200, payload);

    if (path === "/v2/advertisers") {
      const limit = Number(query.get("limit") ?? 10);
      const page = Number(query.get("page") ?? 0);
      const slice = ADVERTISERS.slice(page * limit, page * limit + limit);
      const more = (page + 1) * limit < ADVERTISERS.length;
      return ok({
        _metadata: {
          api_name_version: "advertisers-v2.0.0",
          page,
          limit,
          total: ADVERTISERS.length,
          _links: {
            self: `/v2/advertisers?page=${page}&limit=${limit}`,
            ...(more ? { next: `/v2/advertisers?page=${page + 1}&limit=${limit}` } : {}),
          },
        },
        advertisers: slice,
      });
    }

    const advertiserMatch = /^\/v2\/advertisers\/(\d+)$/.exec(path);
    if (advertiserMatch) {
      const advertiser = ADVERTISERS.find((candidate) => String(candidate.id) === advertiserMatch[1]);
      return advertiser
        ? ok({ _metadata: {}, advertiser: { ...advertiser, network: 1, can_partner: true } })
        : json(404, { error: "not found" });
    }

    const partnershipMatch = /^\/v1\/partnerships\/(\d+)$/.exec(path);
    if (partnershipMatch) {
      const id = Number(partnershipMatch[1]);
      const partnership = PARTNERSHIPS[id];
      const advertiser = ADVERTISERS.find((candidate) => candidate.id === id);
      if (!partnership || !advertiser) return json(404, { error: "No records found" });
      return ok({
        _metadata: { api_name_version: "partnerships-v1.0.0" },
        partnership: {
          advertiser: { id, network: partnership.network, name: advertiser.name, status: "Active", categories: [] },
          status: partnership.status,
        },
      });
    }

    if (path === "/v1/offers") {
      const offers = query.get("advertiser") === "100" ? OFFERS : [];
      return ok({ _metadata: { page: 0, limit: pageSize, total: offers.length, _links: {} }, offers });
    }

    if (path === "/v1/links/deep_links" && init.method === "POST") {
      const request = JSON.parse(body ?? "{}") as { url: string; advertiser_id: number; u1: string };
      const link = `https://click.example.test/deeplink?mid=${request.advertiser_id}&u1=${encodeURIComponent(request.u1)}&murl=${encodeURIComponent(request.url)}`;
      return ok({
        _metadata: {},
        advertiser: {
          id: request.advertiser_id,
          deep_link: { deep_link_url: link, u1: request.u1, url: request.url, name: "" },
        },
      });
    }

    if (path === "/events/1.0/transactions") {
      const start = eventsInput(query.get("transaction_date_start"));
      const end = eventsInput(query.get("transaction_date_end"));
      if (start === null || end === null || start > end) return json(400, { error: "Missing parameter." });
      if (end - start > 30 * DAY) return json(400, { error: "Range should not exceed 30 days" });
      if (start < options.now().getTime() - 100 * DAY) return json(400, { error: "Invalid date." });
      const limit = Number(query.get("limit") ?? 100);
      const page = Number(query.get("page") ?? 1);
      const inRange = transactionRows(options.now()).filter((row) => {
        const at = new Date(row.transaction_date).getTime();
        return at >= start && at <= end;
      });
      return ok(inRange.slice((page - 1) * limit, page * limit));
    }

    if (path === "/advancedreports/1.0") {
      if (!options.webSecurityToken || parsed.searchParams.get("token") !== options.webSecurityToken) {
        return new Response("invalid report token", { status: 401 });
      }
      const report = query.get("reportid");
      const csv =
        report === "1"
          ? "Payment ID,Date,Payment Type,Check Number,Currency Code,Total Commission Amount Paid,Payment Status\npay-1,2026-11-01,direct deposit,check-1,USD,12.50,issued\n"
          : report === "22"
            ? 'Invoice Date,Advertiser ID,Advertiser,Invoice Number,Transaction Commissions,Bonus Amount,CPM & CPC Commissions,Cancelled Commissions,Previously Held Commissions,VAT/GST,Payment Amount,Advertiser Payment Date\n2026-10-31,100,"Northwind, Outdoor",inv-1,10.00,0,0,0,0,0,10.00,11/01/2026\n'
            : report === "23"
              ? "Date,Time,Advertiser ID,Advertiser,Order ID,SKU #,Product Name,Items,Sales,Baseline Commission,Adjusted Commission,Actual Commission,Transaction Payment Status,Reason,Advertiser Payment Memo,Advertiser Payment Date\n10/31/2026,12:00:00,100,Northwind Outdoor,order-1,sku-1,Widget,1,100.00,10.00,9.50,9.50,Paid,,memo,11/01/2026\n"
              : "";
      return new Response(csv, {
        status: 200,
        headers: { date: options.now().toUTCString(), "content-type": "text/csv" },
      });
    }

    return json(404, { error: "unknown path" });
  };

  return { fetch: handler, requests, state };
}

// "YYYY-MM-DD HH:mm:ss" as UTC milliseconds, or null when it is not in that format.
function eventsInput(value: string | null): number | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  return Date.parse(`${value.replace(" ", "T")}Z`);
}
