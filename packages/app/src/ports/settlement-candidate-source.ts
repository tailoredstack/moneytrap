import type { AllocationCandidate } from "@moneytrap/domain";

// The conversions a receipt on one network may clear: approved, and with some amount still open after earlier allocations.
// The adapter nets earlier allocations out, so outstandingMinor is what is still open, not the recognized total. Read-only:
// the matcher never writes through this port.
export interface SettlementCandidateSource {
  listEligibleConversions(networkId: string): Promise<AllocationCandidate[]>;
}
