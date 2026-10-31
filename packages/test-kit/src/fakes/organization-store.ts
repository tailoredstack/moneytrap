import type {
  OrganizationRecord,
  OrganizationStore,
  OrganizationWrite,
  OwnerMembership,
} from "@moneytrap/app/src/ports/organization-store";

/** In-memory reference adapter for the organization store. Both rows are committed together or not at all. */
export class FakeOrganizationStore implements OrganizationStore {
  readonly organizations: OrganizationRecord[] = [];
  readonly memberships: OwnerMembership[] = [];
  /** Test hook: fail the membership write after the organization is staged, to exercise rollback. */
  failMembership = false;

  async createWithOwner(write: OrganizationWrite): Promise<void> {
    const staged = { organization: { ...write.organization }, ownerMembership: { ...write.ownerMembership } };
    if (this.failMembership) throw new Error("membership write failed");
    this.organizations.push(staged.organization);
    this.memberships.push(staged.ownerMembership);
  }
}
