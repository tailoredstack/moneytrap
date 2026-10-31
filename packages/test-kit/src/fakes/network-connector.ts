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
import { type CapabilityProfile, CONNECTOR_OPERATIONS, type ConnectorOperation } from "@moneytrap/domain";

interface FakeNetworkConnectorOptions {
  capabilities?: CapabilityProfile;
  // Makes one operation fail with the given reason, for example temporarily_unavailable or not_authorized.
  failures?: Partial<Record<ConnectorOperation, ConnectorFailure>>;
  // false makes every notification fail its authenticity check (not_authorized).
  signatureValid?: boolean;
}

const EPOCH = new Date(0);

const allSupported = Object.fromEntries(
  CONNECTOR_OPERATIONS.map((operation) => [operation, "supported"]),
) as CapabilityProfile;

/** Programmable network connector. Each call is recorded in `calls`; a failure set for an operation is returned as-is. */
export class FakeNetworkConnector implements NetworkConnector {
  readonly calls: ConnectorOperation[] = [];
  private readonly capabilities: CapabilityProfile;
  private readonly failures: Partial<Record<ConnectorOperation, ConnectorFailure>>;
  private readonly signatureValid: boolean;

  constructor(options: FakeNetworkConnectorOptions = {}) {
    this.capabilities = options.capabilities ?? allSupported;
    this.failures = options.failures ?? {};
    this.signatureValid = options.signatureValid ?? true;
  }

  async validateConnection(): Promise<ConnectorResult<ConnectionCheck>> {
    return this.run("validate_connection", () => ({
      capabilities: this.capabilities,
      rateLimit: null,
      permittedScopes: [],
    }));
  }

  async discoverAdvertisers(_input: { cursor: string | null }): Promise<ConnectorResult<Page<AdvertiserRecord>>> {
    return this.run("discover_advertisers", () => emptyPage<AdvertiserRecord>());
  }

  async discoverPrograms(_input: {
    advertiserSourceId: string;
    cursor: string | null;
  }): Promise<ConnectorResult<Page<ProgramRecord>>> {
    return this.run("discover_programs", () => emptyPage<ProgramRecord>());
  }

  async resolveTrackingDestination(input: TrackingDestinationRequest): Promise<ConnectorResult<TrackingLink>> {
    return this.run("resolve_tracking_destination", () => ({ url: input.destinationUrl, subId: input.subId }));
  }

  async listTransactions(
    _input: TimeRange & { cursor: string | null },
  ): Promise<ConnectorResult<Page<TransactionRecord>>> {
    return this.run("list_transactions", () => emptyPage<TransactionRecord>());
  }

  async listAdjustments(
    _input: TimeRange & { cursor: string | null },
  ): Promise<ConnectorResult<Page<AdjustmentRecord>>> {
    return this.run("list_adjustments", () => emptyPage<AdjustmentRecord>());
  }

  async retrieveSettlementEvidence(
    _input: TimeRange & { cursor: string | null },
  ): Promise<ConnectorResult<Page<SettlementEvidenceRecord>>> {
    return this.run("retrieve_settlement_evidence", () => emptyPage<SettlementEvidenceRecord>());
  }

  async receiveNotification(_input: NotificationEnvelope): Promise<ConnectorResult<VerifiedNotification>> {
    // A forged callback is refused before any field is read, so the failure wins over a configured one.
    if (!this.signatureValid) {
      this.calls.push("receive_notifications");
      return { ok: false, failure: { state: "not_authorized" } };
    }
    return this.run("receive_notifications", () => ({
      eventId: "evt_fake",
      kind: "notification",
      correlationId: null,
    }));
  }

  // An operation the profile does not mark supported fails with that state, so the fake never returns an empty success
  // for it. validate_connection is exempt: it is how the profile itself is read.
  private run<T>(operation: ConnectorOperation, value: () => T): ConnectorResult<T> {
    this.calls.push(operation);
    const failure = this.failures[operation] ?? this.failureFromProfile(operation);
    if (failure) return { ok: false, failure };
    return { ok: true, value: value() };
  }

  private failureFromProfile(operation: ConnectorOperation): ConnectorFailure | undefined {
    if (operation === "validate_connection") return undefined;
    const state = this.capabilities[operation];
    if (state === "supported") return undefined;
    if (state === "temporarily_unavailable") return { state, retryAfterSeconds: null };
    return { state };
  }
}

function emptyPage<T>(): Page<T> {
  return { items: [], nextCursor: null, watermark: EPOCH };
}
