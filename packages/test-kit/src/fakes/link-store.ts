import type {
  LinkAudit,
  LinkEvent,
  LinkPolicy,
  LinkRecord,
  LinkStore,
  LinkWritePrecondition,
} from "@moneytrap/app/src/ports/link-store";
import type { EligibilityDecision, Id, PropertyStatus } from "@moneytrap/domain";

/** In-memory reference adapter for the link store and link policy. It enforces tenant filtering, the version check on update, and the write precondition. */
export class FakeLinkStore implements LinkStore, LinkPolicy {
  readonly rows = new Map<string, LinkRecord>();
  readonly audits: LinkAudit[] = [];
  readonly events: LinkEvent[] = [];
  // Program ID to its allow-list. A program with no entry has no allowed hosts.
  readonly hosts = new Map<string, readonly string[]>();
  // Property ID to its status. A property with no entry is not approved.
  readonly propertyStatuses = new Map<string, PropertyStatus>();
  // Pair key (`propertyId|programId`) to the latest eligibility decision.
  readonly decisions = new Map<string, EligibilityDecision>();

  setAllowedHosts(programId: Id<"program">, hosts: readonly string[]): void {
    this.hosts.set(programId, hosts);
  }

  setPropertyStatus(propertyId: Id<"property">, status: PropertyStatus): void {
    this.propertyStatuses.set(propertyId, status);
  }

  setEligibility(propertyId: Id<"property">, programId: Id<"program">, decision: EligibilityDecision): void {
    this.decisions.set(`${propertyId}|${programId}`, decision);
  }

  async allowedHosts(_organizationId: Id<"organization">, programId: Id<"program">): Promise<readonly string[]> {
    return this.hosts.get(programId) ?? [];
  }

  async latestEligibility(
    _organizationId: Id<"organization">,
    propertyId: Id<"property">,
    programId: Id<"program">,
  ): Promise<EligibilityDecision | null> {
    return this.decisions.get(`${propertyId}|${programId}`) ?? null;
  }

  async find(organizationId: Id<"organization">, linkId: Id<"link">): Promise<LinkRecord | null> {
    const row = this.rows.get(linkId);
    return row && row.organizationId === organizationId ? structuredClone(row) : null;
  }

  async insert(write: {
    record: LinkRecord;
    audit: LinkAudit;
    event: LinkEvent;
    precondition: LinkWritePrecondition | null;
  }): Promise<boolean> {
    if (!this.holds(write.precondition)) return false;
    this.rows.set(write.record.link.id, structuredClone(write.record));
    this.audits.push({ ...write.audit });
    this.events.push({ ...write.event });
    return true;
  }

  async update(write: {
    organizationId: Id<"organization">;
    expectedVersion: number;
    record: LinkRecord;
    audit: LinkAudit;
    event: LinkEvent;
    precondition: LinkWritePrecondition | null;
  }): Promise<boolean> {
    const stored = this.rows.get(write.record.link.id);
    // Another tenant's row, a moved version, or a missing link: nothing is written.
    if (!stored || stored.organizationId !== write.organizationId) return false;
    if (stored.link.version !== write.expectedVersion) return false;
    if (!this.holds(write.precondition)) return false;
    this.rows.set(write.record.link.id, structuredClone(write.record));
    this.audits.push({ ...write.audit });
    this.events.push({ ...write.event });
    return true;
  }

  // The property must still be approved and the latest decision must still allow the program, as the port requires.
  private holds(precondition: LinkWritePrecondition | null): boolean {
    if (!precondition) return true;
    if (this.propertyStatuses.get(precondition.propertyId) !== "approved") return false;
    const decision = this.decisions.get(`${precondition.propertyId}|${precondition.programId}`);
    return decision?.decision === "allow";
  }
}
