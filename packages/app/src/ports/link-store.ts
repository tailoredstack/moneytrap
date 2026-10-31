import type { EligibilityDecision, Id, Link } from "@moneytrap/domain";

export interface LinkRecord {
  link: Link;
  // The tenant that owns the link. Every read is filtered by it.
  organizationId: Id<"organization">;
  programId: Id<"program">;
}

export type LinkAction = "create" | "edit" | "pause" | "resume" | "revoke";

// One row in audit_logs for a link change.
export interface LinkAudit {
  id: Id<"audit">;
  organizationId: Id<"organization">;
  actor: { type: string; id: string };
  action: LinkAction;
  entityType: "link";
  entityId: Id<"link">;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

export interface LinkEvent {
  id: Id<"event">;
  topic: "link.created" | "link.updated";
  aggregateId: Id<"link">;
  aggregateVersion: number;
  payload: Record<string, unknown>;
}

// Program facts the link actions need from the catalog and the eligibility policy. The adapter reads them; the actions
// only decide with them.
export interface LinkPolicy {
  // The hosts this program's destinations may use. Empty means no destination can be allowed.
  allowedHosts(organizationId: Id<"organization">, programId: Id<"program">): Promise<readonly string[]>;
  // The latest eligibility decision for the property and program pair, or null when none has been recorded.
  latestEligibility(
    organizationId: Id<"organization">,
    propertyId: Id<"property">,
    programId: Id<"program">,
  ): Promise<EligibilityDecision | null>;
}

// A monetized write (create, edit, resume) must still hold the gate it passed. The adapter checks, in the same
// transaction as the link row, that the property is approved and the latest eligibility decision allows the program.
// A suspension or a deny decision that lands after the gate therefore blocks the write (CT-006, CT-010).
export interface LinkWritePrecondition {
  propertyId: Id<"property">;
  programId: Id<"program">;
}

// Each write commits its row with its audit row and outbox event, or none of them. The write applies only when the
// stored version still equals expectedVersion (update), and when the precondition still holds (if one is given).
// It returns false and writes nothing when either check fails, so the caller must reload and decide again.
export interface LinkStore {
  find(organizationId: Id<"organization">, linkId: Id<"link">): Promise<LinkRecord | null>;
  insert(write: {
    record: LinkRecord;
    audit: LinkAudit;
    event: LinkEvent;
    precondition: LinkWritePrecondition | null;
  }): Promise<boolean>;
  // The organization is part of the match, so an update can never reach another tenant's row.
  update(write: {
    organizationId: Id<"organization">;
    expectedVersion: number;
    record: LinkRecord;
    audit: LinkAudit;
    event: LinkEvent;
    precondition: LinkWritePrecondition | null;
  }): Promise<boolean>;
}
