import type { LinkAudit, LinkEvent, LinkPolicy, LinkRecord, LinkStore } from "@moneytrap/app/src/ports/link-store";
import type { EligibilityDecision, Id } from "@moneytrap/domain";

/** In-memory reference adapter for the link store and link policy. It enforces tenant filtering and the version check on update. */
export class FakeLinkStore implements LinkStore, LinkPolicy {
  readonly rows = new Map<string, LinkRecord>();
  readonly audits: LinkAudit[] = [];
  readonly events: LinkEvent[] = [];
  // Program ID to its allow-list. A program with no entry has no allowed hosts.
  readonly hosts = new Map<string, readonly string[]>();
  // Pair key (`propertyId|programId`) to the latest eligibility decision.
  readonly decisions = new Map<string, EligibilityDecision>();

  setAllowedHosts(programId: Id<"program">, hosts: readonly string[]): void {
    this.hosts.set(programId, hosts);
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

  async insert(write: { record: LinkRecord; audit: LinkAudit; event: LinkEvent }): Promise<void> {
    this.rows.set(write.record.link.id, structuredClone(write.record));
    this.audits.push({ ...write.audit });
    this.events.push({ ...write.event });
  }

  async update(write: {
    expectedVersion: number;
    record: LinkRecord;
    audit: LinkAudit;
    event: LinkEvent;
  }): Promise<boolean> {
    const stored = this.rows.get(write.record.link.id);
    // Another writer moved the link, or it does not exist: nothing is written.
    if (!stored || stored.link.version !== write.expectedVersion) return false;
    this.rows.set(write.record.link.id, structuredClone(write.record));
    this.audits.push({ ...write.audit });
    this.events.push({ ...write.event });
    return true;
  }
}
