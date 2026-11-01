import type { Clock } from "@moneytrap/app/src/ports/clock";
import type {
  AdjustmentRecord,
  AdvertiserRecord,
  ConnectionCheck,
  ConnectorResult,
  NetworkConnector,
  NotificationEnvelope,
  Page,
  ProgramRecord,
  SettlementEvidenceRecord,
  TimeRange,
  TrackingDestinationRequest,
  TrackingLink,
  TransactionRecord,
  VerifiedNotification,
} from "@moneytrap/app/src/ports/network-connector";
import { type CapabilityProfile, CONNECTOR_OPERATIONS, type ConnectorOperation } from "@moneytrap/domain";
import {
  type ClientConfig,
  DEFAULT_BASE_URL,
  type Diagnostic,
  type FetchLike,
  RakutenClient,
  type Reply,
  unavailable,
} from "./client";
import { issueCursor, parseCursor } from "./cursor";
import {
  asArray,
  asObject,
  type Json,
  MappingError,
  type Partnership,
  termsOf,
  toAdvertiser,
  toPartnership,
  toProgram,
  toTransaction,
  toUnpartneredAdvertiser,
} from "./mappers";

export interface RakutenConnectorConfig {
  clientId: string;
  clientSecret: string;
  // Sent as the scope of the access token request.
  accountId: string;
  clock: Clock;
  // Defaults to https://api.linksynergy.com, the only host the public API specification lists.
  baseUrl?: string;
  // Defaults to the global fetch. Tests pass a fake upstream.
  fetch?: FetchLike;
  // Items per page for the list endpoints. Rakuten allows up to 200. Defaults to 100.
  pageSize?: number;
  requestTimeoutMs?: number;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}

const DAY_MS = 86_400_000;
// The Events API rejects a date range of more than 30 days and a transaction_date_start more than 100 days back.
const EVENTS_WINDOW_MS = 29 * DAY_MS;
const EVENTS_HISTORY_MS = 100 * DAY_MS;
const MAX_OFFER_PAGES = 20;
// Event rows are timed to the second, so a row can sit up to a second outside a window that ends mid-second.
const SECOND_SLOP_MS = 1000;
// A guard against an upstream that ignores `page` and returns the same rows for ever.
const MAX_EVENT_PAGES = 1000;

// list_adjustments: the Events API says commission changes are not reflected after the fact, and no adjustments API is
// published. retrieve_settlement_evidence: the payment reports (Advanced Reports) need a separate web security token and
// publish no response format. receive_notifications: the postback is a plain GET to a URL with no signature, so its
// origin cannot be verified.
const UNSUPPORTED: ReadonlySet<ConnectorOperation> = new Set([
  "list_adjustments",
  "retrieve_settlement_evidence",
  "receive_notifications",
]);

// What Rakuten's public API offers, operation by operation (docs verified in the package README). The three
// unsupported operations have no usable Rakuten API for a publisher, and they fail as `unsupported` without a request.
export const RAKUTEN_CAPABILITIES: CapabilityProfile = Object.fromEntries(
  CONNECTOR_OPERATIONS.map((operation) => [operation, UNSUPPORTED.has(operation) ? "unsupported" : "supported"]),
) as CapabilityProfile;

export class RakutenConnector implements NetworkConnector {
  private readonly client: RakutenClient;
  private readonly accountId: string;
  private readonly pageSize: number;

  constructor(config: RakutenConnectorConfig) {
    for (const field of ["clientId", "clientSecret", "accountId"] as const) {
      if (typeof config[field] !== "string" || config[field].trim() === "") {
        throw new RangeError(`Rakuten connector config: ${field} is required`);
      }
    }
    const pageSize = config.pageSize ?? 100;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
      throw new RangeError("Rakuten connector config: pageSize must be an integer from 1 to 200");
    }
    this.accountId = config.accountId;
    this.pageSize = pageSize;
    const client: ClientConfig = {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      accountId: config.accountId,
      baseUrl: secureBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL),
      clock: config.clock,
      fetch: config.fetch ?? ((url, init) => fetch(url, init)),
      requestTimeoutMs: config.requestTimeoutMs ?? 15_000,
      onDiagnostic: config.onDiagnostic,
    };
    this.client = new RakutenClient(client);
  }

  async validateConnection(): Promise<ConnectorResult<ConnectionCheck>> {
    // The token exchange proves the client credential, and one small read proves the account scope can use the API.
    return this.guarded("validate_connection", async () => {
      const reply = await this.client.get("validate_connection", "/v2/advertisers", { limit: "1" });
      if (reply.kind !== "ok") return this.failureOf("validate_connection", reply);
      return {
        ok: true,
        value: { capabilities: RAKUTEN_CAPABILITIES, rateLimit: null, permittedScopes: [`account:${this.accountId}`] },
      };
    });
  }

  async discoverAdvertisers(input: { cursor: string | null }): Promise<ConnectorResult<Page<AdvertiserRecord>>> {
    const operation = "discover_advertisers";
    const position = parseCursor(input.cursor, { operation, scope: "", size: 1 });
    return this.guarded(operation, async () => {
      // The first request carries no page number, so the upstream's own default applies. Later pages follow its next link.
      const query: Record<string, string> = { limit: String(this.pageSize) };
      if (position) query.page = String(position[0]);
      const reply = await this.client.get(operation, "/v2/advertisers", query);
      if (reply.kind !== "ok") return this.failureOf(operation, reply);
      const body = asObject(reply.body);
      const items = asArray(body.advertisers).map(toAdvertiser);
      const next = nextPage(body, position?.[0] ?? null);
      return {
        ok: true,
        value: {
          items,
          nextCursor: next === null ? null : issueCursor(operation, "", [next]),
          watermark: reply.at,
        },
      };
    });
  }

  // One program per advertiser: the publisher's partnership with it. Its approval is the partnership status.
  async discoverPrograms(input: {
    advertiserSourceId: string;
    cursor: string | null;
  }): Promise<ConnectorResult<Page<ProgramRecord>>> {
    const operation = "discover_programs";
    if (input.cursor !== null) throw new RangeError("cursor was not issued for this query");
    // Rakuten advertiser IDs are integers, so any other value names no advertiser.
    if (!/^\d+$/.test(input.advertiserSourceId)) return this.page([]);
    const id = input.advertiserSourceId;

    return this.guarded(operation, async () => {
      const partnership = await this.partnership(operation, id);
      if ("failure" in partnership) return partnership.failure;
      if (partnership.value === null) return this.page([]);

      // Terms are read for approved partnerships only. The offer text is not documented for other states.
      let terms = "";
      if (partnership.value.approval === "approved") {
        const offers = await this.activeOffers(operation, id);
        if ("failure" in offers) return offers.failure;
        terms = termsOf(offers.value);
      }
      return this.page([toProgram(partnership.value, terms)]);
    });
  }

  async resolveTrackingDestination(input: TrackingDestinationRequest): Promise<ConnectorResult<TrackingLink>> {
    const operation = "resolve_tracking_destination";
    // A link is created only for an advertiser the publisher is partnered with. Anything else is refused.
    if (!/^\d+$/.test(input.programSourceId) || input.subId.trim() === "") {
      return { ok: false, failure: { state: "not_authorized" } };
    }
    return this.guarded(operation, async () => {
      const partnership = await this.partnership(operation, input.programSourceId);
      if ("failure" in partnership) return partnership.failure;
      if (partnership.value?.approval !== "approved") return { ok: false, failure: { state: "not_authorized" } };

      const reply = await this.client.post(operation, "/v1/links/deep_links", {
        url: input.destinationUrl,
        advertiser_id: Number(input.programSourceId),
        u1: input.subId,
      });
      if (reply.kind !== "ok") return this.failureOf(operation, reply);

      const deepLink = asObject(asObject(asObject(reply.body).advertiser).deep_link);
      const url = deepLink.deep_link_url;
      if (typeof url !== "string" || !isHttpUrl(url)) throw new MappingError("malformed_body");
      // The link must carry the sub-ID that was asked for, or a later conversion could not be matched to its click.
      if (deepLink.u1 !== input.subId) throw new MappingError("malformed_body");
      return { ok: true, value: { url, subId: input.subId } };
    });
  }

  // The Events API, by transaction_date. A range longer than the API allows is read as several windows, and the cursor
  // names the window and the page inside it, so a caller sees one continuous list.
  async listTransactions(
    input: TimeRange & { cursor: string | null },
  ): Promise<ConnectorResult<Page<TransactionRecord>>> {
    const operation = "list_transactions";
    const scope = `${input.from.getTime()}..${input.to.getTime()}`;
    const position = parseCursor(input.cursor, { operation, scope, size: 2 });
    const [windowIndex, pageNumber] = position ?? [0, 1];
    if (windowIndex === undefined || pageNumber === undefined || pageNumber < 1) throw cursorRefused();

    // The Events API keeps only the last 100 days, so an older range cannot be served in full. It is refused, not
    // answered with the part that remains. This runs before the range is split, so a very old start costs nothing.
    const now = this.client.now().getTime();
    if (input.from.getTime() < now - EVENTS_HISTORY_MS) return { ok: false, failure: { state: "unsupported" } };

    // Nothing can have happened after now, so the range stops a day past it. That bounds the windows for any `to`.
    const windows = splitRange({ from: input.from, to: new Date(Math.min(input.to.getTime(), now + DAY_MS)) });
    if (position && windowIndex >= windows.length) throw cursorRefused();
    const window = windows[windowIndex];
    if (window === undefined) {
      return { ok: true, value: { items: [], nextCursor: null, watermark: this.client.now() } };
    }

    return this.guarded(operation, async () => {
      const reply = await this.client.get(operation, "/events/1.0/transactions", {
        // The API takes whole seconds. The start rounds down and the end rounds up to the last second before the window
        // ends, so no row in the window is left out. The filter below removes the sub-second excess.
        transaction_date_start: eventsDate(new Date(Math.floor(window.from.getTime() / 1000) * 1000)),
        transaction_date_end: eventsDate(new Date(Math.ceil(window.to.getTime() / 1000) * 1000 - 1000)),
        limit: String(this.pageSize),
        page: String(pageNumber),
      });
      if (reply.kind !== "ok") return this.failureOf(operation, reply);

      const items: TransactionRecord[] = [];
      let rows = 0;
      for (const row of asArray(reply.body)) {
        const item = toTransaction(row);
        const at = item.occurredAt.getTime();
        // A row far outside the window it was asked for means the upstream reads the query dates differently from the
        // documented UTC. That is refused rather than filtered, so rows are never lost quietly.
        if (at < window.from.getTime() - SECOND_SLOP_MS || at >= window.to.getTime() + SECOND_SLOP_MS) {
          throw new MappingError("malformed_body");
        }
        if (item.occurredAt >= input.from && item.occurredAt < input.to) items.push(item);
        rows += 1;
      }
      // The window ends at the first empty page. A short page is not taken as the end, because the API may cap the
      // page size below the one asked for, and the rows behind a short page would be lost.
      let nextCursor: string | null = null;
      if (rows > 0) {
        if (pageNumber >= MAX_EVENT_PAGES) throw new MappingError("malformed_body");
        nextCursor = issueCursor(operation, scope, [windowIndex, pageNumber + 1]);
      } else if (windowIndex + 1 < windows.length) {
        nextCursor = issueCursor(operation, scope, [windowIndex + 1, 1]);
      }
      return { ok: true, value: { items, nextCursor, watermark: reply.at } };
    });
  }

  async listAdjustments(
    _input: TimeRange & { cursor: string | null },
  ): Promise<ConnectorResult<Page<AdjustmentRecord>>> {
    return { ok: false, failure: { state: "unsupported" } };
  }

  async retrieveSettlementEvidence(
    _input: TimeRange & { cursor: string | null },
  ): Promise<ConnectorResult<Page<SettlementEvidenceRecord>>> {
    return { ok: false, failure: { state: "unsupported" } };
  }

  async receiveNotification(_input: NotificationEnvelope): Promise<ConnectorResult<VerifiedNotification>> {
    return { ok: false, failure: { state: "unsupported" } };
  }

  // GET /v1/partnerships/{advertiser-id}. With no partnership, the advertiser is looked up on its own so the program is
  // still reported, with no approval. `value: null` means Rakuten knows no such advertiser.
  private async partnership(
    operation: ConnectorOperation,
    id: string,
  ): Promise<{ value: Partnership | null } | { failure: ConnectorResult<never> }> {
    const partnered = await this.client.get(operation, `/v1/partnerships/${id}`);
    if (partnered.kind === "ok") return { value: toPartnership(partnered.body) };
    if (partnered.kind === "failure") return { failure: { ok: false, failure: partnered.failure } };

    const advertiser = await this.client.get(operation, `/v2/advertisers/${id}`);
    if (advertiser.kind === "ok") return { value: toUnpartneredAdvertiser(advertiser.body) };
    if (advertiser.kind === "failure") return { failure: { ok: false, failure: advertiser.failure } };
    return { value: null };
  }

  // GET /v1/offers for the advertiser, every page. A page that fails fails the whole call, so terms are never partial.
  private async activeOffers(
    operation: ConnectorOperation,
    id: string,
  ): Promise<{ value: unknown[] } | { failure: ConnectorResult<never> }> {
    const offers: unknown[] = [];
    let page: number | null = null;
    for (let count = 0; count < MAX_OFFER_PAGES; count += 1) {
      const query: Record<string, string> = { offer_status: "active", advertiser: id, limit: String(this.pageSize) };
      if (page !== null) query.page = String(page);
      const reply = await this.client.get(operation, "/v1/offers", query);
      if (reply.kind === "failure") return { failure: { ok: false, failure: reply.failure } };
      // No offers for an advertiser is an empty list, but a page that disappears mid-list would make the terms partial.
      if (reply.kind === "not_found") {
        if (count === 0) return { value: offers };
        throw new MappingError("malformed_body");
      }
      const body = asObject(reply.body);
      offers.push(...asArray(body.offers));
      page = nextPage(body, page);
      if (page === null) return { value: offers };
    }
    throw new MappingError("malformed_body");
  }

  private page<T>(items: T[]): ConnectorResult<Page<T>> {
    return { ok: true, value: { items, nextCursor: null, watermark: this.client.now() } };
  }

  // A reply that is not a usable answer, as the failure the port defines. The caller has already handled `ok`.
  private failureOf(operation: ConnectorOperation, reply: Reply): ConnectorResult<never> {
    if (reply.kind === "failure") return { ok: false, failure: reply.failure };
    if (reply.kind === "not_found") this.client.diagnose({ operation, kind: "unexpected_status", status: 404 });
    return { ok: false, failure: unavailable(null) };
  }

  // A body the mappers cannot read is an upstream that is not answering as documented. It is a retryable failure, and
  // the diagnostic names its kind only.
  private async guarded<T>(
    operation: ConnectorOperation,
    run: () => Promise<ConnectorResult<T> | ConnectorResult<never>>,
  ): Promise<ConnectorResult<T>> {
    try {
      return (await run()) as ConnectorResult<T>;
    } catch (error) {
      if (error instanceof MappingError) {
        this.client.diagnose({ operation, kind: error.kind });
        return { ok: false, failure: unavailable(null) };
      }
      throw error;
    }
  }
}

// The credential travels to this host, so it must be https. Plain http is accepted only for a local test server.
function secureBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError("Rakuten connector config: baseUrl must be a URL");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new RangeError("Rakuten connector config: baseUrl must use https");
  }
  return value.replace(/\/+$/, "");
}

function cursorRefused(): RangeError {
  return new RangeError("cursor was not issued for this query");
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

// Rakuten's list endpoints describe the next page in `_metadata._links.next`, for example "/v2/advertisers?page=1&limit=10".
// The page number is read from that link, so the connector never has to know whether the API counts pages from 0 or 1.
function nextPage(body: Json, requested: number | null): number | null {
  const metadata = body._metadata ?? body.metadata;
  if (metadata === undefined || metadata === null) return null;
  const meta = asObject(metadata);
  const links = meta._links ?? meta.links;
  if (links === undefined || links === null) return null;
  const next = asObject(links).next;
  if (next === undefined || next === null || next === "") return null;
  if (typeof next !== "string") throw new MappingError("malformed_body");

  let param: string | null;
  try {
    param = new URL(next, "https://rakuten.invalid").searchParams.get("page");
  } catch {
    throw new MappingError("malformed_body");
  }
  if (param === null || param.trim() === "") throw new MappingError("malformed_body");
  const page = Number(param);
  const current = typeof meta.page === "number" ? meta.page : requested;
  if (!Number.isInteger(page) || page < 0 || (current !== null && page <= current)) {
    throw new MappingError("malformed_body");
  }
  return page;
}

function splitRange(range: TimeRange): TimeRange[] {
  const windows: TimeRange[] = [];
  for (let start = range.from.getTime(); start < range.to.getTime(); start += EVENTS_WINDOW_MS) {
    windows.push({ from: new Date(start), to: new Date(Math.min(start + EVENTS_WINDOW_MS, range.to.getTime())) });
  }
  return windows;
}

// The Events API date format: YYYY-MM-DD HH:mm:ss, read as UTC.
function eventsDate(at: Date): string {
  return at.toISOString().slice(0, 19).replace("T", " ");
}
