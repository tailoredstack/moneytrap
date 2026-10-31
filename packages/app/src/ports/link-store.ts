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

// Each write commits its row with its audit row and outbox event, or none of them. An update applies only when the
// stored version still equals expectedVersion; otherwise it returns false and writes nothing.
export interface LinkStore {
  find(organizationId: Id<"organization">, linkId: Id<"link">): Promise<LinkRecord | null>;
  insert(write: { record: LinkRecord; audit: LinkAudit; event: LinkEvent }): Promise<void>;
  update(write: { expectedVersion: number; record: LinkRecord; audit: LinkAudit; event: LinkEvent }): Promise<boolean>;
}
