import { describe, expect, test } from "bun:test";
import { ID_PREFIXES, type Id, type IdKind, type Principal, type PropertyStatus, type Scope } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { DnsResolver } from "../ports/dns-resolver";
import type {
  AuditWrite,
  PropertyEvent,
  PropertyRecord,
  PropertyStore,
  VerificationChallenge,
} from "../ports/property-store";
import type { VerificationTokens } from "../ports/verification-tokens";
import { requestPropertyChallenge, verifyProperty } from "./verify";

const orgId = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const otherOrgId = "org_01bx5zzkbkactav9wevgemmvrz" as Id<"organization">;
const userId = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const publisherId = "pub_01arz3ndektsv4rrffq69g5fav" as Id<"publisher">;
const propertyId = "prp_01arz3ndektsv4rrffq69g5fav" as Id<"property">;
const recordName = "_moneytrap-verification.example.com";
const DAY = 24 * 60 * 60 * 1000;

const principal: Principal = { userId, memberships: [{ organizationId: orgId, role: "owner" }] };
const scope: Scope = { organizationId: orgId };

// Stub IDs keep assertions readable: each call returns the next value for its kind.
let sequence = 0;
const ids = {
  next<K extends IdKind>(kind: K): Id<K> {
    sequence += 1;
    return `${ID_PREFIXES[kind]}_${String(sequence).padStart(26, "0")}` as Id<K>;
  },
};

class MemoryClock {
  current = new Date("2026-03-01T12:00:00.000Z");
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

// Models the adapter contract: each write checks the property version and commits its rows together, or not at all.
class MemoryPropertyStore implements PropertyStore {
  readonly properties = new Map<string, PropertyRecord>();
  readonly challenges: VerificationChallenge[] = [];
  readonly audits: AuditWrite[] = [];
  readonly events: PropertyEvent[] = [];

  async find(target: Scope, id: Id<"property">): Promise<PropertyRecord | null> {
    const property = this.properties.get(id);
    return property && property.organizationId === target.organizationId ? { ...property } : null;
  }

  async latestChallenge(id: Id<"property">): Promise<VerificationChallenge | null> {
    const found = this.challenges.filter((c) => c.propertyId === id).at(-1);
    return found ? { ...found } : null;
  }

  async issueChallenge(write: {
    property: PropertyRecord;
    nextStatus: PropertyStatus;
    challenge: VerificationChallenge;
    audit: AuditWrite;
    event: PropertyEvent;
  }): Promise<boolean> {
    const current = this.properties.get(write.property.id);
    if (!current || current.version !== write.property.version) return false;
    this.properties.set(current.id, { ...current, status: write.nextStatus, version: current.version + 1 });
    this.challenges.push({ ...write.challenge });
    this.audits.push(write.audit);
    this.events.push(write.event);
    return true;
  }

  async recordAttempt(challengeId: Id<"verification">): Promise<void> {
    const index = this.challenges.findIndex((c) => c.id === challengeId);
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
    const current = this.properties.get(write.property.id);
    if (!current || current.version !== write.property.version) return false;
    this.properties.set(current.id, { ...current, status: write.nextStatus, version: current.version + 1 });
    const index = this.challenges.findIndex((c) => c.id === write.challengeId);
    const challenge = this.challenges[index];
    if (challenge) this.challenges[index] = { ...challenge, verifiedAt: write.verifiedAt };
    this.audits.push(write.audit);
    this.events.push(write.event);
    return true;
  }
}

// Programmable TXT records. A name with no records resolves to an empty list, like NXDOMAIN.
class FakeDns implements DnsResolver {
  readonly records = new Map<string, string[]>();
  readonly lookups: string[] = [];
  failure: Error | null = null;
  // Runs before the lookup answers, so a test can move time forward while the lookup is in flight.
  beforeAnswer: (() => void) | null = null;

  setTxt(name: string, values: string[]): void {
    this.records.set(name, values);
  }

  async resolveTxt(name: string): Promise<string[]> {
    this.lookups.push(name);
    this.beforeAnswer?.();
    if (this.failure) throw this.failure;
    return [...(this.records.get(name) ?? [])];
  }
}

class FakeTokens implements VerificationTokens {
  private count = 0;
  issue(): string {
    this.count += 1;
    return `token-${this.count}`;
  }
  digest(token: string): string {
    return `digest:${token.slice("token-".length)}`;
  }
}

function property(status: PropertyStatus, version = 1): PropertyRecord {
  return {
    id: propertyId,
    organizationId: orgId,
    publisherId,
    type: "website",
    canonicalIdentifier: "Example.com",
    normalizedIdentifier: "example.com",
    status,
    version,
  };
}

function harness(status: PropertyStatus = "draft") {
  const clock = new MemoryClock();
  const store = new MemoryPropertyStore();
  store.properties.set(propertyId, property(status));
  const dns = new FakeDns();
  const tokens = new FakeTokens();
  const ctx = (actorId: string | null = userId): Ctx => ({
    db: undefined as never,
    clock,
    ids,
    actor: { type: "user", id: actorId },
  });
  return { clock, store, dns, tokens, deps: { store, dns, tokens }, ctx };
}

async function pendingWithChallenge() {
  const h = harness("draft");
  const requested = await requestPropertyChallenge(h.ctx(), h.deps, {
    principal,
    scope,
    propertyId,
    method: "dns",
  });
  if (!requested.ok) throw new Error("fixture: challenge request failed");
  return h;
}

describe("TP-W3-009 request DNS challenge", () => {
  test("issues a TXT value and an expiry 24 hours out, and moves a draft to verification pending", async () => {
    const h = harness("draft");
    const result = await requestPropertyChallenge(h.ctx(), h.deps, { principal, scope, propertyId, method: "dns" });

    expect(result).toEqual({
      ok: true,
      value: {
        challengeText: "moneytrap-verification=token-1",
        recordName,
        expiresAt: new Date(h.clock.now().getTime() + DAY),
      },
    });
    expect(h.store.properties.get(propertyId)?.status).toBe("verification_pending");
    expect(h.store.challenges[0]?.challengeHash).toBe("digest:1");
    expect(h.store.events.map((event) => event.topic)).toEqual(["property.verification_challenged"]);
    expect(h.store.audits).toHaveLength(1);
  });

  test("the raw token is kept out of stored rows, events and audit entries", async () => {
    const h = harness("draft");
    await requestPropertyChallenge(h.ctx(), h.deps, { principal, scope, propertyId, method: "dns" });
    const persisted = JSON.stringify({
      challenges: h.store.challenges,
      events: h.store.events,
      audits: h.store.audits,
    });
    expect(persisted).not.toContain("token-1");
  });

  test("a second request replaces the challenge and stays pending", async () => {
    const h = await pendingWithChallenge();
    const second = await requestPropertyChallenge(h.ctx(), h.deps, { principal, scope, propertyId, method: "dns" });

    expect(second.ok && second.value.challengeText).toBe("moneytrap-verification=token-2");
    expect(h.store.properties.get(propertyId)?.status).toBe("verification_pending");
    expect(h.store.challenges.map((c) => c.challengeHash)).toEqual(["digest:1", "digest:2"]);
  });

  test("a property past verification cannot request a challenge", async () => {
    const h = harness("verified");
    const result = await requestPropertyChallenge(h.ctx(), h.deps, { principal, scope, propertyId, method: "dns" });
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("only the dns method is supported in this slice", async () => {
    const h = harness("draft");
    const result = await requestPropertyChallenge(h.ctx(), h.deps, { principal, scope, propertyId, method: "html" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("VALIDATION_FAILED");
  });

  test("a principal without properties:write in the scope gets FORBIDDEN", async () => {
    const h = harness("draft");
    const outsider: Principal = { userId, memberships: [] };
    const result = await requestPropertyChallenge(h.ctx(), h.deps, {
      principal: outsider,
      scope,
      propertyId,
      method: "dns",
    });
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(h.store.challenges).toHaveLength(0);
  });

  test("an actor other than the principal is UNAUTHENTICATED", async () => {
    const h = harness("draft");
    const other = "usr_01bx5zzkbkactav9wevgemmvrz";
    const result = await requestPropertyChallenge(h.ctx(other), h.deps, {
      principal,
      scope,
      propertyId,
      method: "dns",
    });
    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });

  test("a property in another organization is not found (tenant isolation)", async () => {
    const h = harness("draft");
    const otherPrincipal: Principal = { userId, memberships: [{ organizationId: otherOrgId, role: "owner" }] };
    const result = await requestPropertyChallenge(h.ctx(), h.deps, {
      principal: otherPrincipal,
      scope: { organizationId: otherOrgId },
      propertyId,
      method: "dns",
    });
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });
});

describe("TP-W3-010 verify with a matching TXT record", () => {
  test("moves a pending property to verified and writes one verified event", async () => {
    const h = await pendingWithChallenge();
    h.dns.setTxt(recordName, ["moneytrap-verification=token-1"]);

    const result = await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId });

    expect(result).toEqual({ ok: true, value: { verificationStatus: "verified", changed: true } });
    expect(h.store.properties.get(propertyId)?.status).toBe("verified");
    expect(h.store.events.at(-1)?.topic).toBe("property.verified");
    expect(h.dns.lookups).toEqual([recordName]);
  });

  test("a matching record among other TXT values still verifies", async () => {
    const h = await pendingWithChallenge();
    h.dns.setTxt(recordName, ["v=spf1 -all", "  moneytrap-verification=token-1  "]);
    const result = await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId });
    expect(result).toEqual({ ok: true, value: { verificationStatus: "verified", changed: true } });
  });
});

describe("TP-W3-011 verify with a missing record", () => {
  test("stays verification pending with no event, and a later retry succeeds", async () => {
    const h = await pendingWithChallenge();

    const missing = await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId });
    expect(missing).toEqual({ ok: true, value: { verificationStatus: "verification_pending", changed: false } });
    expect(h.store.properties.get(propertyId)?.status).toBe("verification_pending");
    expect(h.store.events.map((e) => e.topic)).toEqual(["property.verification_challenged"]);
    expect(h.store.challenges[0]?.attempts).toBe(1);

    h.dns.setTxt(recordName, ["moneytrap-verification=token-1"]);
    const retried = await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId });
    expect(retried).toEqual({ ok: true, value: { verificationStatus: "verified", changed: true } });
  });

  test("another token in the TXT record does not verify", async () => {
    const h = await pendingWithChallenge();
    h.dns.setTxt(recordName, ["moneytrap-verification=someone-else"]);
    const result = await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId });
    expect(result).toEqual({ ok: true, value: { verificationStatus: "verification_pending", changed: false } });
  });

  test("a DNS lookup failure is PROVIDER_UNAVAILABLE and leaves the property pending", async () => {
    const h = await pendingWithChallenge();
    h.dns.failure = new Error("SERVFAIL");
    const result = await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId });
    expect(result).toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE" });
    expect(h.store.properties.get(propertyId)?.status).toBe("verification_pending");
  });
});

describe("TP-W3-012 verify with an expired challenge", () => {
  test("is rejected with TOKEN_EXPIRED at expiry, without a DNS lookup", async () => {
    const h = await pendingWithChallenge();
    h.dns.setTxt(recordName, ["moneytrap-verification=token-1"]);
    h.clock.advance(DAY);

    const result = await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId });

    expect(result).toEqual({ ok: false, code: "TOKEN_EXPIRED" });
    expect(h.dns.lookups).toEqual([]);
    expect(h.store.properties.get(propertyId)?.status).toBe("verification_pending");
  });

  test("a new challenge after expiry verifies", async () => {
    const h = await pendingWithChallenge();
    h.clock.advance(DAY);
    await requestPropertyChallenge(h.ctx(), h.deps, { principal, scope, propertyId, method: "dns" });
    h.dns.setTxt(recordName, ["moneytrap-verification=token-2"]);

    const result = await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId });
    expect(result).toEqual({ ok: true, value: { verificationStatus: "verified", changed: true } });
  });

  test("a challenge that expires while the lookup is in flight is rejected, not verified", async () => {
    const h = await pendingWithChallenge();
    h.dns.setTxt(recordName, ["moneytrap-verification=token-1"]);
    h.dns.beforeAnswer = () => h.clock.advance(DAY);

    const result = await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId });

    expect(result).toEqual({ ok: false, code: "TOKEN_EXPIRED" });
    expect(h.store.properties.get(propertyId)?.status).toBe("verification_pending");
    expect(h.store.events.some((e) => e.topic === "property.verified")).toBe(false);
  });

  test("a superseded challenge id is a STATE_CONFLICT", async () => {
    const h = await pendingWithChallenge();
    await requestPropertyChallenge(h.ctx(), h.deps, { principal, scope, propertyId, method: "dns" });
    const stale = h.store.challenges[0]?.id;
    if (!stale) throw new Error("fixture: no challenge");
    h.dns.setTxt(recordName, ["moneytrap-verification=token-1"]);

    const result = await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId, challengeId: stale });
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });
});

describe("TP-W3-013 concurrent and repeated verify", () => {
  test("two concurrent verifies make one state change and one verified event", async () => {
    const h = await pendingWithChallenge();
    h.dns.setTxt(recordName, ["moneytrap-verification=token-1"]);

    const [first, second] = await Promise.all([
      verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId }),
      verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId }),
    ]);

    const results = [first, second];
    expect(results.every((r) => r.ok && r.value.verificationStatus === "verified")).toBe(true);
    expect(results.filter((r) => r.ok && r.value.changed)).toHaveLength(1);
    expect(h.store.events.filter((e) => e.topic === "property.verified")).toHaveLength(1);
    expect(h.store.properties.get(propertyId)?.status).toBe("verified");
  });

  test("a repeat verify after success is idempotent and writes nothing", async () => {
    const h = await pendingWithChallenge();
    h.dns.setTxt(recordName, ["moneytrap-verification=token-1"]);
    await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId });
    const eventsBefore = h.store.events.length;

    const again = await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId });

    expect(again).toEqual({ ok: true, value: { verificationStatus: "verified", changed: false } });
    expect(h.store.events).toHaveLength(eventsBefore);
  });

  test("verifying a draft property is a STATE_CONFLICT", async () => {
    const h = harness("draft");
    const result = await verifyProperty(h.ctx(), h.deps, { principal, scope, propertyId });
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });
});
