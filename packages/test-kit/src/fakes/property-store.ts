import type {
  AuditWrite,
  PropertyEvent,
  PropertyRecord,
  PropertyStore,
  VerificationChallenge,
} from "@moneytrap/app/src/ports/property-store";
import type { Id, PropertyStatus } from "@moneytrap/domain";

/** In-memory reference adapter for the property store. Each write is a compare-and-set on the property version. */
export class FakePropertyStore implements PropertyStore {
  readonly properties = new Map<string, PropertyRecord>();
  readonly challenges: VerificationChallenge[] = [];
  readonly audits: AuditWrite[] = [];
  readonly events: PropertyEvent[] = [];

  seed(property: PropertyRecord): void {
    this.properties.set(property.id, { ...property });
  }

  async find(
    scope: { organizationId: Id<"organization"> },
    propertyId: Id<"property">,
  ): Promise<PropertyRecord | null> {
    const property = this.properties.get(propertyId);
    return property && property.organizationId === scope.organizationId ? { ...property } : null;
  }

  async latestChallenge(propertyId: Id<"property">): Promise<VerificationChallenge | null> {
    const found = this.challenges.filter((challenge) => challenge.propertyId === propertyId).at(-1);
    return found ? { ...found } : null;
  }

  async issueChallenge(write: {
    property: PropertyRecord;
    nextStatus: PropertyStatus;
    challenge: VerificationChallenge;
    audit: AuditWrite;
    event: PropertyEvent;
  }): Promise<boolean> {
    if (!this.advance(write.property, write.nextStatus)) return false;
    this.challenges.push({ ...write.challenge });
    this.audits.push(write.audit);
    this.events.push(write.event);
    return true;
  }

  async recordAttempt(challengeId: Id<"verification">): Promise<void> {
    const index = this.challenges.findIndex((candidate) => candidate.id === challengeId);
    const challenge = this.challenges[index];
    if (challenge) this.challenges[index] = { ...challenge, attempts: challenge.attempts + 1 };
  }

  async completeVerification(write: {
    property: PropertyRecord;
    nextStatus: PropertyStatus;
    challengeId: Id<"verification">;
    verifiedAt: Date;
    audit: AuditWrite;
    event: PropertyEvent;
  }): Promise<boolean> {
    if (!this.advance(write.property, write.nextStatus)) return false;
    const index = this.challenges.findIndex((candidate) => candidate.id === write.challengeId);
    const challenge = this.challenges[index];
    if (challenge) this.challenges[index] = { ...challenge, verifiedAt: write.verifiedAt };
    this.audits.push(write.audit);
    this.events.push(write.event);
    return true;
  }

  private advance(expected: PropertyRecord, nextStatus: PropertyStatus): boolean {
    const current = this.properties.get(expected.id);
    if (!current || current.version !== expected.version) return false;
    this.properties.set(current.id, { ...current, status: nextStatus, version: current.version + 1 });
    return true;
  }
}
