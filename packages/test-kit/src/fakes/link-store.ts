import type {
  LinkAudit,
  LinkEvent,
  LinkPolicy,
  LinkRecord,
  LinkStore,
  LinkWritePrecondition,
  RowClaimFence,
} from "@moneytrap/app/src/ports/link-store";
import type { EligibilityDecision, Id, PropertyStatus } from "@moneytrap/domain";

/** In-memory reference adapter for the link store and link policy. It enforces tenant filtering, the version check on update, and the write precondition. */
export class FakeLinkStore implements LinkStore, LinkPolicy {
  readonly rows = new Map<string, LinkRecord>();
  readonly audits: LinkAudit[] = [];
  readonly events: LinkEvent[] = [];
  // Program ID to its allow-list. A program with no entry has no allowed hosts.
  readonly hosts = new Map<string, readonly string[]>();
  // Organization and property (`organizationId|propertyId`) to its status. A property with no entry is not approved.
  readonly propertyStatuses = new Map<string, PropertyStatus>();
  // Organization, property, and program (`organizationId|propertyId|programId`) to the latest eligibility decision.
  readonly decisions = new Map<string, EligibilityDecision>();
  // Whether a bulk row claim still holds. Without it, a write that names a row claim is refused (fails closed).
  rowClaimHolds: ((claim: RowClaimFence) => boolean) | null = null;

  setAllowedHosts(programId: Id<"program">, hosts: readonly string[]): void {
    this.hosts.set(programId, hosts);
  }

  setPropertyStatus(organizationId: Id<"organization">, propertyId: Id<"property">, status: PropertyStatus): void {
    this.propertyStatuses.set(`${organizationId}|${propertyId}`, status);
  }

  setEligibility(
    organizationId: Id<"organization">,
    propertyId: Id<"property">,
    programId: Id<"program">,
    decision: EligibilityDecision,
  ): void {
    this.decisions.set(`${organizationId}|${propertyId}|${programId}`, decision);
  }

  async allowedHosts(_organizationId: Id<"organization">, programId: Id<"program">): Promise<readonly string[]> {
    return this.hosts.get(programId) ?? [];
  }

  async latestEligibility(
    organizationId: Id<"organization">,
    propertyId: Id<"property">,
    programId: Id<"program">,
  ): Promise<EligibilityDecision | null> {
    return this.decisions.get(`${organizationId}|${propertyId}|${programId}`) ?? null;
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
    // An insert never replaces an existing link.
    if (this.rows.has(write.record.link.id)) return false;
    if (!this.holds(write.record.organizationId, write.precondition)) return false;
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
    // The row must belong to the tenant the write names, and the record must carry that same tenant.
    if (write.record.organizationId !== write.organizationId) return false;
    // Another tenant's row, a moved version, or a missing link: nothing is written.
    if (!stored || stored.organizationId !== write.organizationId) return false;
    if (stored.link.version !== write.expectedVersion) return false;
    if (!this.holds(write.organizationId, write.precondition)) return false;
    this.rows.set(write.record.link.id, structuredClone(write.record));
    this.audits.push({ ...write.audit });
    this.events.push({ ...write.event });
    return true;
  }

  // The property must still be approved in the write's organization, the latest decision must still allow the program,
  // and the host must still be on the program's allow-list, as the port requires.
  private holds(organizationId: Id<"organization">, precondition: LinkWritePrecondition | null): boolean {
    if (!precondition) return true;
    if (precondition.rowClaim && !this.rowClaimHolds?.(precondition.rowClaim)) return false;
    const { propertyId, programId, host } = precondition;
    if (this.propertyStatuses.get(`${organizationId}|${propertyId}`) !== "approved") return false;
    if (this.decisions.get(`${organizationId}|${propertyId}|${programId}`)?.decision !== "allow") return false;
    return allowsHost(this.hosts.get(programId) ?? [], host);
  }
}

// Matches an allow-list entry the way the destination check does: a bare host, normalised by the URL parser.
function allowsHost(entries: readonly string[], host: string): boolean {
  return entries.some((entry) => {
    const bare = entry.trim();
    if (!/^[^/@:?#\\\s]+$/.test(bare)) return false;
    try {
      return new URL(`https://${bare}`).hostname === host;
    } catch {
      return false;
    }
  });
}
