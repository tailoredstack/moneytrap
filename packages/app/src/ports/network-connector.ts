import type { CapabilityProfile, Id, Money } from "@moneytrap/domain";

// Why an operation did not return data. Every failure is explicit, so a caller never reads a missing capability as an
// empty result (TP-W4-004).
export type ConnectorFailure =
  | { state: "unsupported" }
  | { state: "temporarily_unavailable"; retryAfterSeconds: number | null }
  | { state: "not_authorized" };

export type ConnectorResult<T> = { ok: true; value: T } | { ok: false; failure: ConnectorFailure };

// One page of a cursor-paged source. `watermark` is the freshness instant the upstream reports for this page.
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  watermark: Date;
}

// The upstream's own identity for a record and the revision it reported. Source identity is never the platform ID.
export interface SourceIdentity {
  sourceId: string;
  revision: string;
}

export interface ConnectionCheck {
  capabilities: CapabilityProfile;
  rateLimit: { remaining: number; resetsAt: Date } | null;
  permittedScopes: readonly string[];
}

export interface AdvertiserRecord extends SourceIdentity {
  name: string;
}

export type ProgramApprovalState = "approved" | "pending" | "rejected";

export interface ProgramRecord extends SourceIdentity {
  advertiserSourceId: string;
  name: string;
  terms: string;
  countries: readonly string[];
  channels: readonly string[];
  // null when the network does not expose approval state for the program.
  approval: ProgramApprovalState | null;
}

export interface TrackingDestinationRequest {
  propertyId: Id<"property">;
  programSourceId: string;
  destinationUrl: string;
  subId: string;
}

export interface TrackingLink {
  url: string;
  subId: string;
}

export interface TransactionRecord extends SourceIdentity {
  status: "pending" | "approved" | "declined" | "reversed";
  amount: Money;
  occurredAt: Date;
  subId: string | null;
}

export interface AdjustmentRecord extends SourceIdentity {
  originalTransactionId: string;
  amount: Money;
  occurredAt: Date;
}

export interface SettlementEvidenceRecord {
  remittanceId: string;
  amount: Money;
  paidAt: Date;
}

export interface TimeRange {
  from: Date;
  to: Date;
}

// The raw callback as received. The connector verifies its authenticity before it reads any field.
export interface NotificationEnvelope {
  headers: Readonly<Record<string, string>>;
  body: string;
}

export interface VerifiedNotification {
  eventId: string;
  kind: string;
  correlationId: string | null;
}

// Each operation in spec §6.1. Adapters map upstream errors to ConnectorFailure, and never return a partial result as
// complete. Credentials never appear in any input, output, or error.
export interface NetworkConnector {
  validateConnection(): Promise<ConnectorResult<ConnectionCheck>>;
  discoverAdvertisers(input: { cursor: string | null }): Promise<ConnectorResult<Page<AdvertiserRecord>>>;
  discoverPrograms(input: {
    advertiserSourceId: string;
    cursor: string | null;
  }): Promise<ConnectorResult<Page<ProgramRecord>>>;
  resolveTrackingDestination(input: TrackingDestinationRequest): Promise<ConnectorResult<TrackingLink>>;
  listTransactions(input: TimeRange & { cursor: string | null }): Promise<ConnectorResult<Page<TransactionRecord>>>;
  listAdjustments(input: TimeRange & { cursor: string | null }): Promise<ConnectorResult<Page<AdjustmentRecord>>>;
  retrieveSettlementEvidence(
    input: TimeRange & { cursor: string | null },
  ): Promise<ConnectorResult<Page<SettlementEvidenceRecord>>>;
  receiveNotification(input: NotificationEnvelope): Promise<ConnectorResult<VerifiedNotification>>;
}
