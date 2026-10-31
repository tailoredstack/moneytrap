import type { Money } from "@moneytrap/domain";

// Why the provider refused a request or callback. A consumer switches on these, so the set is closed.
export type PayoutRejectReason = "signature" | "malformed" | "request-conflict" | "unknown-transfer" | "event-mismatch";

// Why a provider call produced no answer. A timeout is never a failed transfer: the provider may have created it
// (spec §6.2), so the caller records an unknown outcome and queries before any further attempt.
export type PayoutProviderFailure =
  | { state: "timeout" }
  | { state: "unavailable" }
  | { state: "rejected"; reason: PayoutRejectReason };

export type PayoutProviderResult<T> = { ok: true; value: T } | { ok: false; failure: PayoutProviderFailure };

// The provider's view of a transfer. `processing` and `paid` are provider states; the platform's own state machine
// (WP-7.9) decides what they mean for a payout.
export type ProviderTransferStatus = "processing" | "paid" | "failed";

export interface TransferRequest {
  // Stable across retries. The provider treats the same requestId as the same transfer, so a retry cannot pay twice.
  requestId: string;
  amount: Money;
  // A provider reference to the payout method. Raw account data never reaches this port (TP-W7-008).
  payoutMethodRef: string;
}

export interface TransferAccepted {
  requestId: string;
  transferId: string;
}

export interface TransferSnapshot {
  requestId: string;
  transferId: string;
  status: ProviderTransferStatus;
  // Monotonic per transfer. Consumers order events by this, never by local receipt time.
  sequence: number;
  occurredAt: Date;
}

// The raw status callback as received. The provider verifies its authenticity before any field is read.
export interface StatusCallbackEnvelope {
  headers: Readonly<Record<string, string>>;
  body: string;
}

export interface VerifiedStatusEvent extends TransferSnapshot {
  // The provider's identity for this event. A redelivered callback carries the same eventId.
  eventId: string;
}

// The payout operations from spec §6.2 that WP-7.4 covers: initiate with a stable request identity, inspect status,
// and verify status callbacks. Callbacks can repeat and can arrive out of order, so consumers must be idempotent.
export interface PayoutProvider {
  initiateTransfer(input: TransferRequest): Promise<PayoutProviderResult<TransferAccepted>>;
  inspectTransfer(requestId: string): Promise<PayoutProviderResult<TransferSnapshot | null>>;
  receiveStatusCallback(input: StatusCallbackEnvelope): Promise<PayoutProviderResult<VerifiedStatusEvent>>;
}
