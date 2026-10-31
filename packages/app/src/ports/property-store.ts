import type { Id, Property, PropertyStatus } from "@moneytrap/domain";

export interface PropertyRecord extends Property {
  // The tenant that owns the property. Every read is filtered by it.
  readonly organizationId: Id<"organization">;
  // Bumped on each write. A write only succeeds against the version it was read at (compare-and-set).
  readonly version: number;
}

export interface VerificationChallenge {
  readonly id: Id<"verification">;
  readonly propertyId: Id<"property">;
  readonly method: "dns";
  // Digest of the token. The token itself is shown once and never stored.
  readonly challengeHash: string;
  readonly expiresAt: Date;
  readonly verifiedAt: Date | null;
  readonly attempts: number;
  readonly createdAt: Date;
}

export interface AuditWrite {
  readonly id: Id<"event">;
  readonly organizationId: Id<"organization">;
  readonly actor: { type: string; id: string | null };
  readonly action: string;
  readonly entityType: "property";
  readonly entityId: Id<"property">;
  readonly metadata: Record<string, unknown>;
  readonly occurredAt: Date;
}

export interface PropertyEvent {
  readonly id: Id<"event">;
  readonly topic: "property.verification_challenged" | "property.verified";
  readonly aggregateId: Id<"property">;
  readonly aggregateVersion: number;
  readonly payload: Record<string, unknown>;
}

// Each write commits its rows together with the audit row and the outbox event, or none of them. A write returns
// false when the property version moved since it was read, and then writes nothing.
export interface PropertyStore {
  find(scope: { organizationId: Id<"organization"> }, propertyId: Id<"property">): Promise<PropertyRecord | null>;
  latestChallenge(propertyId: Id<"property">): Promise<VerificationChallenge | null>;
  issueChallenge(write: {
    property: PropertyRecord;
    nextStatus: PropertyStatus;
    challenge: VerificationChallenge;
    audit: AuditWrite;
    event: PropertyEvent;
  }): Promise<boolean>;
  // Counts a verification attempt on a challenge. Not a state change, so it writes no event or audit row.
  recordAttempt(challengeId: Id<"verification">): Promise<void>;
  completeVerification(write: {
    property: PropertyRecord;
    nextStatus: PropertyStatus;
    challengeId: Id<"verification">;
    verifiedAt: Date;
    audit: AuditWrite;
    event: PropertyEvent;
  }): Promise<boolean>;
}
