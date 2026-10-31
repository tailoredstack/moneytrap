import type {
  AdjustmentRecord,
  AdvertiserRecord,
  ConnectionCheck,
  ConnectorFailure,
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
import { type ConnectorOperation, Money } from "@moneytrap/domain";
import { FIXTURE_NAMES, type FixtureName, RECORDED_FIXTURES, type RecordedFixture } from "./fixtures";

export interface ConnectorRequest {
  operation: ConnectorOperation;
  cursor: string | null;
}

const RETRY_AFTER_SECONDS = 30;
const CURSOR_PREFIX = "sim1.";

/**
 * Replays a recorded fixture through the connector port. Every answer is a pure function of the fixture and the
 * request, so the same calls always return the same results. Each response is a fresh copy, so a caller that mutates
 * it cannot change later answers. Each request is logged in `requests`.
 */
export class RecordedNetworkSimulator implements NetworkConnector {
  readonly requests: ConnectorRequest[] = [];
  private readonly fixture: RecordedFixture;
  private interruptFired = false;

  // A shipped fixture by name, or a variant of one built by a test (for example a different capability profile).
  constructor(source: FixtureName | RecordedFixture) {
    if (typeof source === "string") {
      if (!FIXTURE_NAMES.includes(source)) throw new RangeError(`unknown network fixture ${source}`);
      this.fixture = RECORDED_FIXTURES[source];
    } else {
      this.fixture = source;
    }
  }

  async validateConnection(): Promise<ConnectorResult<ConnectionCheck>> {
    this.requests.push({ operation: "validate_connection", cursor: null });
    if (!this.fixture.credentialEnabled) return { ok: false, failure: { state: "not_authorized" } };
    return {
      ok: true,
      value: copy({ capabilities: this.fixture.capabilities, rateLimit: null, permittedScopes: ["read"] }),
    };
  }

  async discoverAdvertisers(input: { cursor: string | null }): Promise<ConnectorResult<Page<AdvertiserRecord>>> {
    return this.page("discover_advertisers", "", input.cursor, this.fixture.advertisers);
  }

  async discoverPrograms(input: {
    advertiserSourceId: string;
    cursor: string | null;
  }): Promise<ConnectorResult<Page<ProgramRecord>>> {
    const programs = this.fixture.programs.filter((program) => program.advertiserSourceId === input.advertiserSourceId);
    // A malformed program is passed through as recorded; the catalog sync (WP-4.6) rejects it.
    return this.page("discover_programs", input.advertiserSourceId, input.cursor, programs as ProgramRecord[]);
  }

  async resolveTrackingDestination(input: TrackingDestinationRequest): Promise<ConnectorResult<TrackingLink>> {
    this.requests.push({ operation: "resolve_tracking_destination", cursor: null });
    const failure = this.gate("resolve_tracking_destination");
    if (failure) return { ok: false, failure };
    // A link is created only for a program the fixture reports as approved. Anything else is refused as not_authorized.
    const program = this.fixture.programs.find((candidate) => candidate.sourceId === input.programSourceId);
    if (program?.approval !== "approved") return { ok: false, failure: { state: "not_authorized" } };
    const query = `subid=${encodeURIComponent(input.subId)}&dest=${encodeURIComponent(input.destinationUrl)}`;
    return { ok: true, value: { url: `https://track.sim.test/${program.sourceId}?${query}`, subId: input.subId } };
  }

  async listTransactions(
    input: TimeRange & { cursor: string | null },
  ): Promise<ConnectorResult<Page<TransactionRecord>>> {
    return this.page(
      "list_transactions",
      rangeScope(input),
      input.cursor,
      this.fixture.transactions.filter((item) => inRange(item.occurredAt, input)),
    );
  }

  async listAdjustments(
    input: TimeRange & { cursor: string | null },
  ): Promise<ConnectorResult<Page<AdjustmentRecord>>> {
    return this.page(
      "list_adjustments",
      rangeScope(input),
      input.cursor,
      this.fixture.adjustments.filter((item) => inRange(item.occurredAt, input)),
    );
  }

  async retrieveSettlementEvidence(
    input: TimeRange & { cursor: string | null },
  ): Promise<ConnectorResult<Page<SettlementEvidenceRecord>>> {
    return this.page(
      "retrieve_settlement_evidence",
      rangeScope(input),
      input.cursor,
      this.fixture.settlements.filter((item) => inRange(item.paidAt, input)),
    );
  }

  async receiveNotification(input: NotificationEnvelope): Promise<ConnectorResult<VerifiedNotification>> {
    this.requests.push({ operation: "receive_notifications", cursor: null });
    // A forged callback is refused before any field is read, so the failure wins over a configured one.
    const failure = this.gate("receive_notifications");
    if (failure) return { ok: false, failure };
    if (input.headers["x-sim-signature"] !== this.fixture.notification.signature) {
      return { ok: false, failure: { state: "not_authorized" } };
    }
    return { ok: true, value: copy(this.fixture.notification.event) };
  }

  // `scope` is the query the cursor belongs to (advertiser, or time range). A cursor only resumes the query it came from.
  private page<T>(
    operation: ConnectorOperation,
    scope: string,
    cursor: string | null,
    items: T[],
  ): ConnectorResult<Page<T>> {
    this.requests.push({ operation, cursor });
    const failure = this.gate(operation);
    if (failure) return { ok: false, failure };

    const offset = parseCursor(cursor, { operation, scope, pageSize: this.fixture.pageSize, length: items.length });
    const interrupt = this.fixture.interruptOnce;
    if (!this.interruptFired && interrupt?.operation === operation && interrupt.atOffset === offset) {
      this.interruptFired = true;
      return { ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: RETRY_AFTER_SECONDS } };
    }

    const end = offset + this.fixture.pageSize;
    const nextCursor = end < items.length ? issueCursor(operation, scope, end) : null;
    return {
      ok: true,
      value: copy({ items: items.slice(offset, end), nextCursor, watermark: this.fixture.watermark }),
    };
  }

  // Credential first, then the capability profile. validate_connection is exempt from the profile check so the profile
  // can always be read.
  private gate(operation: ConnectorOperation): ConnectorFailure | undefined {
    if (!this.fixture.credentialEnabled) return { state: "not_authorized" };
    if (operation === "validate_connection") return undefined;
    const state = this.fixture.capabilities[operation];
    if (state === "supported") return undefined;
    if (state === "temporarily_unavailable") return { state, retryAfterSeconds: null };
    return { state };
  }
}

function inRange(at: Date, range: TimeRange): boolean {
  return at.getTime() >= range.from.getTime() && at.getTime() < range.to.getTime();
}

function rangeScope(range: TimeRange): string {
  return `${range.from.getTime()}..${range.to.getTime()}`;
}

// Cursors are opaque tokens that name the operation, the query scope, and the item offset. A token from another query
// or operation, a fabricated one, or one that is not a page boundary of this fixture is a caller bug, so it throws.
function issueCursor(operation: ConnectorOperation, scope: string, offset: number): string {
  const payload = JSON.stringify([operation, scope, offset]);
  return `${CURSOR_PREFIX}${Buffer.from(payload, "utf8").toString("base64url")}`;
}

function parseCursor(
  cursor: string | null,
  expected: { operation: ConnectorOperation; scope: string; pageSize: number; length: number },
): number {
  if (cursor === null) return 0;
  const invalid = () => new RangeError("cursor was not issued for this query");
  if (!cursor.startsWith(CURSOR_PREFIX)) throw invalid();
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(decoded) || decoded.length !== 3) throw invalid();
  const [operation, scope, offset] = decoded;
  if (operation !== expected.operation || scope !== expected.scope) throw invalid();
  if (!Number.isSafeInteger(offset) || offset < 0) throw invalid();
  const onPageBoundary = offset % expected.pageSize === 0;
  const withinItems = offset === 0 || offset < expected.length;
  if (!onPageBoundary || !withinItems) throw invalid();
  return offset;
}

// Deep copy for the value shapes the fixtures use: plain objects, arrays, Dates, and Money. Returned values never share
// a mutable object with the fixture or with an earlier response.
function copy<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof Money) return Money.of(value.amount, value.currency) as T;
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, copy(field)])) as T;
  }
  return value;
}
