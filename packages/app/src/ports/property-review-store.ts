import type { Id, Property, PropertyStatus } from "@moneytrap/domain";

export interface PropertyReviewRecord {
  property: Property;
  organizationId: Id<"organization">;
}

// One row in audit_logs for a property transition. The reason, when there is one, sits in metadata.
export interface PropertyTransitionAudit {
  id: Id<"audit">;
  organizationId: Id<"organization">;
  actor: { type: string; id: string };
  action: "submit" | "approve" | "reject" | "suspend" | "reinstate";
  entityType: "property";
  entityId: Id<"property">;
  metadata: { reason?: string };
  occurredAt: Date;
}

export interface PropertyTransitionWrite {
  // The organization and status the property must still hold for the write to apply. The adapter checks both in the
  // same conditional update as the status change, so a property that moved tenants writes nothing.
  expectedOrganizationId: Id<"organization">;
  expectedStatus: PropertyStatus;
  property: Property;
  audit: PropertyTransitionAudit;
}

// The adapter writes the property status and the audit row in one transaction: either both exist afterwards or
// neither does. recordTransition returns false, and writes nothing, when the property no longer holds expectedStatus.
export interface PropertyReviewStore {
  find(id: Id<"property">): Promise<PropertyReviewRecord | null>;
  recordTransition(write: PropertyTransitionWrite): Promise<boolean>;
  // Every audit row for one property, oldest first. Filtered by organization, so another tenant's rows never appear.
  auditTrail(organizationId: Id<"organization">, propertyId: Id<"property">): Promise<PropertyTransitionAudit[]>;
}
