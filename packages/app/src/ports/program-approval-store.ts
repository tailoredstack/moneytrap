import type { Id } from "@moneytrap/domain";
import type { ProgramApprovalState } from "./network-connector";

// A stored request for one property and program. `networkApproval` is what the latest synced revision of the program
// reports, or null when no revision has been synced. The store never decides approval; the app layer reads it from here.
export interface ProgramApprovalRecord {
  propertyId: Id<"property">;
  programId: string;
  requestedAt: Date;
  networkApproval: ProgramApprovalState | null;
}

export interface ProgramApprovalWrite {
  organizationId: Id<"organization">;
  propertyId: Id<"property">;
  programId: string;
  requestedAt: Date;
  actor: { type: string; id: string };
  audit: { id: Id<"audit">; metadata: Record<string, unknown> };
  event: { id: Id<"event">; payload: Record<string, unknown> };
}

// unknown_property: the property is not in the organization, so nothing is written.
// unknown_program: no program has that ID, so nothing is written.
// recorded: this call wrote the request, its audit row, and its event.
// existing: a request was already stored for the pair; nothing is written and the stored request is returned.
export type ProgramApprovalWriteOutcome =
  | { kind: "unknown_property" }
  | { kind: "unknown_program" }
  | { kind: "recorded"; record: ProgramApprovalRecord }
  | { kind: "existing"; record: ProgramApprovalRecord };

// Each write commits its rows with the audit row and the outbox event, or none of them. A request is written once per
// property and program, so a repeat call changes nothing.
export interface ProgramApprovalStore {
  request(write: ProgramApprovalWrite): Promise<ProgramApprovalWriteOutcome>;
  // Reads are filtered by organization, so another tenant's request is never returned.
  find(
    organizationId: Id<"organization">,
    propertyId: Id<"property">,
    programId: string,
  ): Promise<ProgramApprovalRecord | null>;
}
