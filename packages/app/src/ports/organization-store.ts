import type { Id, OrganizationStatus } from "@moneytrap/domain";

export interface OrganizationRecord {
  id: Id<"organization">;
  name: string;
  country: string;
  baseCurrency: string;
  status: OrganizationStatus;
  createdBy: Id<"user">;
  createdAt: Date;
  updatedAt: Date;
}

export interface OwnerMembership {
  organizationId: Id<"organization">;
  userId: Id<"user">;
  role: "owner";
}

export interface OrganizationWrite {
  organization: OrganizationRecord;
  ownerMembership: OwnerMembership;
}

// Persists a new organization and its owner membership. The adapter must write both rows in one
// transaction: either both exist afterwards or neither does (TP-W2-027).
export interface OrganizationStore {
  createWithOwner(write: OrganizationWrite): Promise<void>;
}
