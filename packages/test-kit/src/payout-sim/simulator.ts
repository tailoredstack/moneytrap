import type {
  PayoutProvider,
  PayoutProviderResult,
  ProviderTransferStatus,
  StatusCallbackEnvelope,
  TransferAccepted,
  TransferRequest,
  TransferSnapshot,
  VerifiedStatusEvent,
} from "@moneytrap/app/src/ports/payout-provider";

// The provider scenarios in wave-07-settlement-payouts.md §5. Each maps to one documented provider behavior.
export const PAYOUT_SCENARIOS = [
  "happy",
  "timeout-then-exists",
  "timeout-then-absent",
  "duplicate-callback",
  "out-of-order",
  "outage",
] as const;

export type PayoutScenario = (typeof PAYOUT_SCENARIOS)[number];

const SIGNATURE_HEADER = "x-sim-signature";
const VALID_SIGNATURE = "sim-valid";
const START = new Date("2026-01-01T00:00:00.000Z");

interface TransferRecord {
  requestId: string;
  transferId: string;
  // The request content the transfer was created with. A repeat call must match it, or the request ID was reused.
  amountMinor: bigint;
  currency: string;
  payoutMethodRef: string;
  // Provider statuses in the order the provider produced them. Sequence is the 1-based index into this list.
  timeline: ProviderTransferStatus[];
}

interface PendingCallback {
  record: TransferRecord;
  sequence: number;
}

/**
 * Deterministic payout provider. Every answer follows from the scenario and the calls made so far, with no ambient time
 * or randomness. A timeout on initiate is a timeout, and the scenario decides whether the transfer exists anyway. Each
 * transfer produces status callbacks, which `takeCallbacks` hands out with the scenario's delivery faults applied.
 */
export class PayoutProviderSimulator implements PayoutProvider {
  private readonly transfers = new Map<string, TransferRecord>();
  private readonly timedOutRequests = new Set<string>();
  private pendingCallbacks: PendingCallback[] = [];
  private queryTimeouts = 0;

  constructor(readonly scenario: PayoutScenario) {
    if (!PAYOUT_SCENARIOS.includes(scenario)) throw new RangeError(`unknown payout scenario ${scenario}`);
  }

  async initiateTransfer(input: TransferRequest): Promise<PayoutProviderResult<TransferAccepted>> {
    if (this.scenario === "outage") return { ok: false, failure: { state: "unavailable" } };

    // The same request ID is the same transfer: a repeat call with the same content returns the transfer already
    // created. A changed amount or payout method under a reused request ID is a conflict, never a silent accept.
    const existing = this.transfers.get(input.requestId);
    if (existing) {
      if (!sameRequest(existing, input))
        return { ok: false, failure: { state: "rejected", reason: "request-conflict" } };
      return { ok: true, value: accepted(existing) };
    }

    const firstAttempt = !this.timedOutRequests.has(input.requestId);
    if (firstAttempt && this.scenario.startsWith("timeout-")) {
      this.timedOutRequests.add(input.requestId);
      // Only timeout-then-exists leaves a transfer behind. timeout-then-absent drops the request before the provider
      // created anything, so a retry is the first creation.
      if (this.scenario === "timeout-then-exists") this.create(input);
      return { ok: false, failure: { state: "timeout" } };
    }

    return { ok: true, value: accepted(this.create(input)) };
  }

  async inspectTransfer(requestId: string): Promise<PayoutProviderResult<TransferSnapshot | null>> {
    if (this.scenario === "outage") return { ok: false, failure: { state: "unavailable" } };
    if (this.queryTimeouts > 0) {
      this.queryTimeouts -= 1;
      return { ok: false, failure: { state: "timeout" } };
    }
    const record = this.transfers.get(requestId);
    if (!record) return { ok: true, value: null };
    return { ok: true, value: snapshot(record, record.timeline.length) };
  }

  async receiveStatusCallback(input: StatusCallbackEnvelope): Promise<PayoutProviderResult<VerifiedStatusEvent>> {
    if (input.headers[SIGNATURE_HEADER] !== VALID_SIGNATURE) {
      return { ok: false, failure: { state: "rejected", reason: "signature" } };
    }
    const parsed = parseBody(input.body);
    if (!parsed) return { ok: false, failure: { state: "rejected", reason: "malformed" } };
    // A correctly signed callback for a transfer this provider never created is refused, not replayed as real.
    const record = this.transfers.get(parsed.requestId);
    if (!record || record.transferId !== parsed.transferId) {
      return { ok: false, failure: { state: "rejected", reason: "unknown-transfer" } };
    }
    // The event must be one this transfer produced: a real sequence step, carrying the status the timeline gives it.
    // The event identity and provider timestamp are part of the event too, so a consumer that dedupes by eventId sees
    // the same identity the provider issued for that step.
    const expected = {
      eventId: `evt_${record.transferId}_${parsed.sequence}`,
      status: record.timeline[parsed.sequence - 1],
      occurredAt: occurredAt(parsed.sequence).getTime(),
    };
    if (
      parsed.eventId !== expected.eventId ||
      parsed.status !== expected.status ||
      parsed.occurredAt.getTime() !== expected.occurredAt
    ) {
      return { ok: false, failure: { state: "rejected", reason: "event-mismatch" } };
    }
    return { ok: true, value: parsed };
  }

  /**
   * Test-only fault injection, not one of the §5 provider scenarios: the next `count` inspections time out, so a query
   * can be unknown as well as the dispatch.
   */
  timeoutNextInspections(count: number): void {
    this.queryTimeouts += count;
  }

  /**
   * Returns the status callbacks the provider has not yet delivered. The scenario shapes delivery: duplicate-callback
   * repeats every callback, and out-of-order delivers them in reverse.
   */
  takeCallbacks(): StatusCallbackEnvelope[] {
    const due = this.pendingCallbacks;
    this.pendingCallbacks = [];
    let delivered = due.map(envelope);
    if (this.scenario === "duplicate-callback") delivered = delivered.flatMap((item) => [item, item]);
    if (this.scenario === "out-of-order") delivered = delivered.reverse();
    return delivered;
  }

  private create(input: TransferRequest): TransferRecord {
    const record: TransferRecord = {
      requestId: input.requestId,
      transferId: `tr_${input.requestId}`,
      amountMinor: input.amount.amount,
      currency: input.amount.currency,
      payoutMethodRef: input.payoutMethodRef,
      timeline: ["processing", "paid"],
    };
    this.transfers.set(record.requestId, record);
    for (let sequence = 1; sequence <= record.timeline.length; sequence++) {
      this.pendingCallbacks.push({ record, sequence });
    }
    return record;
  }
}

function envelope({ record, sequence }: PendingCallback): StatusCallbackEnvelope {
  const event = {
    eventId: `evt_${record.transferId}_${sequence}`,
    requestId: record.requestId,
    transferId: record.transferId,
    status: record.timeline[sequence - 1],
    sequence,
    occurredAt: occurredAt(sequence).toISOString(),
  };
  return { headers: { [SIGNATURE_HEADER]: VALID_SIGNATURE }, body: JSON.stringify(event) };
}

function sameRequest(record: TransferRecord, input: TransferRequest): boolean {
  return (
    record.amountMinor === input.amount.amount &&
    record.currency === input.amount.currency &&
    record.payoutMethodRef === input.payoutMethodRef
  );
}

function accepted(record: TransferRecord): TransferAccepted {
  return { requestId: record.requestId, transferId: record.transferId };
}

function snapshot(record: TransferRecord, sequence: number): TransferSnapshot {
  return {
    requestId: record.requestId,
    transferId: record.transferId,
    status: record.timeline[sequence - 1] as ProviderTransferStatus,
    sequence,
    occurredAt: occurredAt(sequence),
  };
}

// Provider timestamps order the events, so the simulator stamps each sequence step with a fixed instant.
function occurredAt(sequence: number): Date {
  return new Date(START.getTime() + sequence * 1000);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseBody(body: string): VerifiedStatusEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const event = raw as Record<string, unknown>;
  const statuses: unknown[] = ["processing", "paid", "failed"];
  if (
    !nonEmpty(event.eventId) ||
    !nonEmpty(event.requestId) ||
    !nonEmpty(event.transferId) ||
    !statuses.includes(event.status) ||
    !Number.isSafeInteger(event.sequence) ||
    (event.sequence as number) < 1 ||
    typeof event.occurredAt !== "string" ||
    Number.isNaN(Date.parse(event.occurredAt))
  ) {
    return null;
  }
  return {
    eventId: event.eventId,
    requestId: event.requestId,
    transferId: event.transferId,
    status: event.status as ProviderTransferStatus,
    sequence: event.sequence as number,
    occurredAt: new Date(event.occurredAt),
  };
}
