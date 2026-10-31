import type { ProgramApprovalState } from "@moneytrap/app/src/ports/network-connector";
import type {
  ProgramApprovalRecord,
  ProgramApprovalStore,
  ProgramApprovalWrite,
  ProgramApprovalWriteOutcome,
} from "@moneytrap/app/src/ports/program-approval-store";
import type { Id } from "@moneytrap/domain";

/** In-memory reference adapter for the program approval store. It enforces the same tenant, existence, and uniqueness checks. */
export class FakeProgramApprovalStore implements ProgramApprovalStore {
  // Property ID to owning organization.
  readonly properties = new Map<string, string>();
  // Program ID to the approval its latest synced revision reports. Only sync may change it, through setNetworkApproval.
  readonly programs = new Map<string, ProgramApprovalState | null>();
  readonly requests = new Map<string, { organizationId: string; requestedAt: Date }>();
  readonly audits: ProgramApprovalWrite["audit"][] = [];
  readonly events: ProgramApprovalWrite["event"][] = [];

  setNetworkApproval(programId: string, approval: ProgramApprovalState | null): void {
    this.programs.set(programId, approval);
  }

  async request(write: ProgramApprovalWrite): Promise<ProgramApprovalWriteOutcome> {
    if (this.properties.get(write.propertyId) !== write.organizationId) return { kind: "unknown_property" };
    if (!this.programs.has(write.programId)) return { kind: "unknown_program" };

    const key = pairKey(write.propertyId, write.programId);
    const existing = this.requests.get(key);
    if (existing) return { kind: "existing", record: this.view(write.propertyId, write.programId) };

    this.requests.set(key, { organizationId: write.organizationId, requestedAt: write.requestedAt });
    this.audits.push({ ...write.audit });
    this.events.push({ ...write.event });
    return { kind: "recorded", record: this.view(write.propertyId, write.programId) };
  }

  async find(
    organizationId: Id<"organization">,
    propertyId: Id<"property">,
    programId: string,
  ): Promise<ProgramApprovalRecord | null> {
    const stored = this.requests.get(pairKey(propertyId, programId));
    if (!stored || stored.organizationId !== organizationId) return null;
    return this.view(propertyId, programId);
  }

  private view(propertyId: string, programId: string): ProgramApprovalRecord {
    const stored = this.requests.get(pairKey(propertyId, programId));
    if (!stored) throw new Error("fake program approval store: no request for the pair");
    return {
      propertyId: propertyId as Id<"property">,
      programId,
      requestedAt: stored.requestedAt,
      networkApproval: this.programs.get(programId) ?? null,
    };
  }
}

function pairKey(propertyId: string, programId: string): string {
  return `${propertyId}|${programId}`;
}
