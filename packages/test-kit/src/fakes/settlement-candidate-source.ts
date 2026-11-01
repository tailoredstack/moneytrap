import type { SettlementCandidateSource } from "@moneytrap/app/src/ports/settlement-candidate-source";
import type { AllocationCandidate } from "@moneytrap/domain";

/** In-memory stand-in for the eligible-conversion lookup. A network maps to the conversions its receipts may clear. */
export class FakeSettlementCandidateSource implements SettlementCandidateSource {
  private readonly byNetwork = new Map<string, AllocationCandidate[]>();

  /** Seeds one eligible conversion on a network, with what is still open on it. */
  addCandidate(networkId: string, candidate: AllocationCandidate): void {
    const candidates = this.byNetwork.get(networkId) ?? [];
    candidates.push({ ...candidate });
    this.byNetwork.set(networkId, candidates);
  }

  async listEligibleConversions(networkId: string): Promise<AllocationCandidate[]> {
    return (this.byNetwork.get(networkId) ?? []).map((candidate) => ({ ...candidate }));
  }
}
