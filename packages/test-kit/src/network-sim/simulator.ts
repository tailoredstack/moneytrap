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
import type { ConnectorOperation } from "@moneytrap/domain";
import { FIXTURE_NAMES, type FixtureName, RECORDED_FIXTURES, type RecordedFixture } from "./fixtures";

export interface ConnectorRequest {
  operation: ConnectorOperation;
  cursor: string | null;
}

const RETRY_AFTER_SECONDS = 30;

/**
 * Replays a recorded fixture through the connector port. Every answer is a pure function of the fixture and the
 * request, so the same calls always return the same results. Each request is logged in `requests`.
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
      value: { capabilities: this.fixture.capabilities, rateLimit: null, permittedScopes: ["read"] },
    };
  }

  async discoverAdvertisers(input: { cursor: string | null }): Promise<ConnectorResult<Page<AdvertiserRecord>>> {
    return this.page("discover_advertisers", input.cursor, this.fixture.advertisers);
  }

  async discoverPrograms(input: {
    advertiserSourceId: string;
    cursor: string | null;
  }): Promise<ConnectorResult<Page<ProgramRecord>>> {
    const programs = this.fixture.programs.filter((program) => program.advertiserSourceId === input.advertiserSourceId);
    // A malformed program is passed through as recorded; the catalog sync (WP-4.6) rejects it.
    return this.page("discover_programs", input.cursor, programs as ProgramRecord[]);
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
      input.cursor,
      this.fixture.transactions.filter((item) => inRange(item.occurredAt, input)),
    );
  }

  async listAdjustments(
    input: TimeRange & { cursor: string | null },
  ): Promise<ConnectorResult<Page<AdjustmentRecord>>> {
    return this.page(
      "list_adjustments",
      input.cursor,
      this.fixture.adjustments.filter((item) => inRange(item.occurredAt, input)),
    );
  }

  async retrieveSettlementEvidence(
    input: TimeRange & { cursor: string | null },
  ): Promise<ConnectorResult<Page<SettlementEvidenceRecord>>> {
    return this.page(
      "retrieve_settlement_evidence",
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
    return { ok: true, value: this.fixture.notification.event };
  }

  private page<T>(operation: ConnectorOperation, cursor: string | null, items: T[]): ConnectorResult<Page<T>> {
    this.requests.push({ operation, cursor });
    const failure = this.gate(operation);
    if (failure) return { ok: false, failure };

    const offset = parseCursor(cursor);
    const interrupt = this.fixture.interruptOnce;
    if (!this.interruptFired && interrupt?.operation === operation && interrupt.atOffset === offset) {
      this.interruptFired = true;
      return { ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: RETRY_AFTER_SECONDS } };
    }

    const end = offset + this.fixture.pageSize;
    const nextCursor = end < items.length ? String(end) : null;
    return {
      ok: true,
      value: { items: items.slice(offset, end), nextCursor, watermark: this.fixture.watermark },
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

// Cursors are item offsets. Anything else was not issued by this simulator, so it is a caller bug and throws.
function parseCursor(cursor: string | null): number {
  if (cursor === null) return 0;
  if (!/^\d+$/.test(cursor)) throw new RangeError(`invalid simulator cursor ${cursor}`);
  return Number(cursor);
}
