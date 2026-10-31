import { describe, expect, test } from "bun:test";
import {
  approveProperty,
  createWebsiteProperty,
  type EligibilityDecision,
  type Id,
  type IdKind,
  markPropertyVerified,
  type Property,
  type PropertyStatus,
  parseId,
  requestPropertyVerification,
  submitPropertyForReview,
  suspendProperty,
} from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type {
  LinkAudit,
  LinkEvent,
  LinkPolicy,
  LinkRecord,
  LinkStore,
  LinkWritePrecondition,
} from "../ports/link-store";
import type { PropertyReviewRecord, PropertyReviewStore } from "../ports/property-review-store";
import {
  createActiveLink,
  editLinkDestination,
  pauseLinkAction,
  previewLink,
  resumeLinkAction,
  revokeLinkAction,
} from "./link-actions";

const orgId = parseId("organization", "org_01arz3ndektsv4rrffq69g5fav") as Id<"organization">;
const otherOrgId = parseId("organization", "org_01bx5zzkbkactav9wevgemmvrz") as Id<"organization">;
const publisherId = parseId("publisher", "pub_01arz3ndektsv4rrffq69g5fav") as Id<"publisher">;
const propertyId = parseId("property", "prp_01arz3ndektsv4rrffq69g5fav") as Id<"property">;
const programId = parseId("program", "prg_01arz3ndektsv4rrffq69g5fav") as Id<"program">;
const linkId = parseId("link", "lnk_01arz3ndektsv4rrffq69g5fav") as Id<"link">;
const actorId = "usr_01arz3ndektsv4rrffq69g5fav";
const auditId = parseId("audit", "aud_01arz3ndektsv4rrffq69g5fav") as Id<"audit">;
const eventId = parseId("event", "evt_01arz3ndektsv4rrffq69g5fav") as Id<"event">;

const allowed = ["shop.example.com"];
const destination = "https://shop.example.com/item";
const clock = { now: () => new Date("2026-10-31T10:20:00.000Z") };
const ids = {
  next<K extends IdKind>(kind: K): Id<K> {
    if (kind === "event") return eventId as unknown as Id<K>;
    if (kind === "link") return linkId as unknown as Id<K>;
    return auditId as unknown as Id<K>;
  },
};

function ctxFor(id: string | null): Ctx {
  return { db: undefined as never, clock, ids, actor: { type: "user", id } };
}

const allowEligibility: EligibilityDecision = { decision: "allow", policyVersion: 1, checks: [] };

// The state the gate reads and the store checks in its precondition. One object, so a test can change it mid-command.
interface Live {
  status: PropertyStatus;
  decision: EligibilityDecision | null;
  hosts: readonly string[];
}

// Builds a property at the given status through the domain state machine, so fixtures obey the real lifecycle.
function propertyIn(status: PropertyStatus): Property {
  const created = createWebsiteProperty({ id: propertyId, publisherId, canonicalIdentifier: "example.com" });
  if (!created.ok) throw new Error("fixture: create failed");
  if (status === "draft") return created.value;
  const pending = requestPropertyVerification(created.value);
  if (!pending.ok) throw new Error("fixture: request failed");
  if (status === "verification_pending") return pending.value;
  const verified = markPropertyVerified(pending.value);
  if (!verified.ok) throw new Error("fixture: verify failed");
  if (status === "verified") return verified.value;
  const review = submitPropertyForReview(verified.value);
  if (!review.ok) throw new Error("fixture: submit failed");
  if (status === "review_pending") return review.value;
  const approved = approveProperty(review.value);
  if (!approved.ok) throw new Error("fixture: approve failed");
  if (status === "approved") return approved.value;
  const suspended = suspendProperty(approved.value);
  if (!suspended.ok) throw new Error("fixture: suspend failed");
  return suspended.value;
}

// Reads the property's status from the live state, so a change made mid-command is what the gate sees next.
class MemoryProperties implements PropertyReviewStore {
  constructor(private readonly live: Live) {}
  async find(id: Id<"property">): Promise<PropertyReviewRecord | null> {
    if (id !== propertyId) return null;
    return { property: propertyIn(this.live.status), organizationId: orgId };
  }
  async recordTransition() {
    return false;
  }
  async auditTrail() {
    return [];
  }
}

// Models the adapter contract: an insert or a version-checked update writes its row with its audit and event, or nothing.
// The precondition is checked against the same live state the gate read.
class MemoryLinks implements LinkStore {
  rows = new Map<string, LinkRecord>();
  audits: LinkAudit[] = [];
  events: LinkEvent[] = [];

  constructor(private readonly live: Live) {}

  seed(record: LinkRecord) {
    this.rows.set(record.link.id, record);
  }
  async find(organizationId: Id<"organization">, id: Id<"link">) {
    const row = this.rows.get(id);
    return row && row.organizationId === organizationId ? row : null;
  }
  async insert(write: {
    record: LinkRecord;
    audit: LinkAudit;
    event: LinkEvent;
    precondition: LinkWritePrecondition | null;
  }) {
    if (!this.holds(write.precondition)) return false;
    this.rows.set(write.record.link.id, write.record);
    this.audits.push(write.audit);
    this.events.push(write.event);
    return true;
  }
  async update(write: {
    organizationId: Id<"organization">;
    expectedVersion: number;
    record: LinkRecord;
    audit: LinkAudit;
    event: LinkEvent;
    precondition: LinkWritePrecondition | null;
  }) {
    const stored = this.rows.get(write.record.link.id);
    if (!stored || stored.organizationId !== write.organizationId) return false;
    if (stored.link.version !== write.expectedVersion) return false;
    if (!this.holds(write.precondition)) return false;
    this.rows.set(write.record.link.id, write.record);
    this.audits.push(write.audit);
    this.events.push(write.event);
    return true;
  }
  private holds(precondition: LinkWritePrecondition | null): boolean {
    if (!precondition) return true;
    return this.live.status === "approved" && this.live.decision?.decision === "allow";
  }
}

function policyFor(live: Live): LinkPolicy {
  return {
    async allowedHosts() {
      return live.hosts;
    },
    async latestEligibility() {
      return live.decision;
    },
  };
}

function setup(
  options: { status?: PropertyStatus; decision?: EligibilityDecision | null; hosts?: readonly string[] } = {},
) {
  const live: Live = {
    status: options.status ?? "approved",
    decision: options.decision === undefined ? allowEligibility : options.decision,
    hosts: options.hosts ?? allowed,
  };
  const properties = new MemoryProperties(live);
  const links = new MemoryLinks(live);
  const deps = { links, properties, policy: policyFor(live) };
  return { deps, links, live };
}

// A link in the given state, seeded directly, so each test starts from a known row.
function seededLink(links: MemoryLinks, status: "active" | "paused" | "revoked", version = 2) {
  const link = {
    id: linkId,
    publisherId,
    propertyId,
    slug: linkId,
    destinationUrl: destination,
    status,
    version,
  } as const;
  links.seed({ link, organizationId: orgId, programId });
}

// Changes the live state between the gate and the write, as a concurrent suspension or decision would.
function changeBeforeWrite(links: MemoryLinks, change: (live: Live) => void, live: Live) {
  const insert = links.insert.bind(links);
  const update = links.update.bind(links);
  links.insert = async (write) => {
    change(live);
    return insert(write);
  };
  links.update = async (write) => {
    change(live);
    return update(write);
  };
}

const createInput = { organizationId: orgId, propertyId, programId, destination };

describe("create", () => {
  test("TP-W5-005: an approved property with an eligible program creates an active link", async () => {
    const { deps, links } = setup();
    const result = await createActiveLink(ctxFor(actorId), deps, createInput);
    expect(result).toMatchObject({ ok: true, value: { status: "active", version: 2, destinationUrl: destination } });
    expect(links.events).toHaveLength(1);
    expect(links.events[0]?.topic).toBe("link.created");
    expect(links.audits[0]?.action).toBe("create");
  });

  test("TP-W5-006: a suspended property is refused with the property precondition and writes nothing", async () => {
    const { deps, links } = setup({ status: "suspended" });
    const result = await createActiveLink(ctxFor(actorId), deps, createInput);
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT", reason: "property_not_approved" });
    expect(links.rows.size).toBe(0);
  });

  test("TP-W5-006: a verified but unapproved property is refused (CT-006)", async () => {
    const { deps, links } = setup({ status: "verified" });
    const result = await createActiveLink(ctxFor(actorId), deps, createInput);
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT", reason: "property_not_approved" });
    expect(links.rows.size).toBe(0);
  });

  test("TP-W5-007: an ineligible program is refused with its reasons", async () => {
    const decision: EligibilityDecision = { decision: "deny", policyVersion: 1, reasons: ["geography"], checks: [] };
    const { deps, links } = setup({ decision });
    const result = await createActiveLink(ctxFor(actorId), deps, createInput);
    expect(result).toEqual({ ok: false, code: "PROGRAM_INELIGIBLE", reasons: ["geography"] });
    expect(links.rows.size).toBe(0);
  });

  test("a program with no recorded eligibility decision is refused as unknown", async () => {
    const { deps } = setup({ decision: null });
    const result = await createActiveLink(ctxFor(actorId), deps, createInput);
    expect(result).toEqual({ ok: false, code: "PROGRAM_INELIGIBLE", reasons: ["unknown"] });
  });

  test("a destination host off the program's allow-list is refused and writes nothing", async () => {
    const { deps, links } = setup();
    const result = await createActiveLink(ctxFor(actorId), deps, {
      ...createInput,
      destination: "https://evil.example.org/item",
    });
    expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED" });
    expect(links.rows.size).toBe(0);
  });

  test("a property of another tenant is RESOURCE_NOT_FOUND", async () => {
    const { deps, links } = setup();
    const result = await createActiveLink(ctxFor(actorId), deps, { ...createInput, organizationId: otherOrgId });
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(links.rows.size).toBe(0);
  });

  test("a caller that is not a user is UNAUTHENTICATED", async () => {
    const { deps } = setup();
    expect(await createActiveLink(ctxFor(null), deps, createInput)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });

  test("the property is suspended between the gate and the write: the write is refused and nothing is stored", async () => {
    const { deps, links, live } = setup();
    changeBeforeWrite(links, (state) => (state.status = "suspended"), live);
    const result = await createActiveLink(ctxFor(actorId), deps, createInput);
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(links.rows.size).toBe(0);
    expect(links.events).toHaveLength(0);
  });

  test("the decision flips to deny between the gate and the write: the write is refused", async () => {
    const { deps, links, live } = setup();
    changeBeforeWrite(
      links,
      (state) => (state.decision = { decision: "deny", policyVersion: 1, reasons: ["contract"], checks: [] }),
      live,
    );
    expect(await createActiveLink(ctxFor(actorId), deps, createInput)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(links.rows.size).toBe(0);
  });
});

describe("preview", () => {
  test("TP-W5-008: a preview returns the normalised destination and writes no row, audit, or event", async () => {
    const { deps, links } = setup();
    const result = await previewLink(ctxFor(actorId), deps, {
      ...createInput,
      destination: "https://SHOP.example.com/item",
    });
    expect(result).toEqual({
      ok: true,
      value: { propertyId, programId, destinationUrl: "https://shop.example.com/item", host: "shop.example.com" },
    });
    expect(links.rows.size).toBe(0);
    expect(links.events).toHaveLength(0);
    expect(links.audits).toHaveLength(0);
  });

  test("a preview of an unapproved property is refused with the same precondition as create", async () => {
    const { deps } = setup({ status: "review_pending" });
    expect(await previewLink(ctxFor(actorId), deps, createInput)).toEqual({
      ok: false,
      code: "STATE_CONFLICT",
      reason: "property_not_approved",
    });
  });

  test("a preview of another tenant's property is RESOURCE_NOT_FOUND", async () => {
    const { deps } = setup();
    expect(await previewLink(ctxFor(actorId), deps, { ...createInput, organizationId: otherOrgId })).toEqual({
      ok: false,
      code: "RESOURCE_NOT_FOUND",
    });
  });
});

describe("edit destination", () => {
  test("TP-W5-009: an edit re-validates the destination and bumps the version", async () => {
    const { deps, links } = setup();
    seededLink(links, "active");
    const result = await editLinkDestination(ctxFor(actorId), deps, {
      organizationId: orgId,
      linkId,
      destination: "https://shop.example.com/other",
    });
    expect(result).toMatchObject({ ok: true, value: { version: 3, destinationUrl: "https://shop.example.com/other" } });
    expect(links.events.at(-1)?.topic).toBe("link.updated");
  });

  test("an edit to a host off the allow-list is refused and keeps the version", async () => {
    const { deps, links } = setup();
    seededLink(links, "active");
    const result = await editLinkDestination(ctxFor(actorId), deps, {
      organizationId: orgId,
      linkId,
      destination: "https://evil.example.org/x",
    });
    expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED" });
    expect(links.rows.get(linkId)?.link.version).toBe(2);
  });

  test("an edit of a link whose property was suspended is refused", async () => {
    const { deps, links } = setup({ status: "suspended" });
    seededLink(links, "active");
    const result = await editLinkDestination(ctxFor(actorId), deps, { organizationId: orgId, linkId, destination });
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT", reason: "property_not_approved" });
  });

  test("a revoked link reports STATE_CONFLICT, not the property reason, even when its property is suspended", async () => {
    const { deps, links } = setup({ status: "suspended" });
    seededLink(links, "revoked");
    const result = await editLinkDestination(ctxFor(actorId), deps, { organizationId: orgId, linkId, destination });
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("a stale version loses the compare-and-set and writes nothing", async () => {
    const { deps, links } = setup();
    seededLink(links, "active");
    const original = links.update.bind(links);
    links.update = async (write) => {
      links.rows.set(linkId, { ...write.record, link: { ...write.record.link, version: 99 } });
      return original(write);
    };
    const result = await editLinkDestination(ctxFor(actorId), deps, {
      organizationId: orgId,
      linkId,
      destination,
    });
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(links.audits).toHaveLength(0);
  });

  test("the decision flips to deny between the gate and the write: the edit is refused", async () => {
    const { deps, links, live } = setup();
    seededLink(links, "active");
    changeBeforeWrite(
      links,
      (state) => (state.decision = { decision: "deny", policyVersion: 1, reasons: ["channel"], checks: [] }),
      live,
    );
    const result = await editLinkDestination(ctxFor(actorId), deps, {
      organizationId: orgId,
      linkId,
      destination: "https://shop.example.com/other",
    });
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(links.rows.get(linkId)?.link.destinationUrl).toBe(destination);
  });

  test("a caller that is not a user is UNAUTHENTICATED", async () => {
    const { deps, links } = setup();
    seededLink(links, "active");
    expect(await editLinkDestination(ctxFor(null), deps, { organizationId: orgId, linkId, destination })).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
  });
});

describe("pause, resume, revoke", () => {
  test("TP-W5-010: pause then resume each change the state and bump the version", async () => {
    const { deps, links } = setup();
    seededLink(links, "active");
    const paused = await pauseLinkAction(ctxFor(actorId), deps, { organizationId: orgId, linkId });
    expect(paused).toMatchObject({ ok: true, value: { status: "paused", version: 3 } });

    const resumed = await resumeLinkAction(ctxFor(actorId), deps, { organizationId: orgId, linkId });
    expect(resumed).toMatchObject({ ok: true, value: { status: "active", version: 4 } });
    expect(links.audits.map((audit) => audit.action)).toEqual(["pause", "resume"]);
  });

  test("resume is refused when the property is no longer approved", async () => {
    const { deps, links } = setup({ status: "suspended" });
    seededLink(links, "paused");
    const result = await resumeLinkAction(ctxFor(actorId), deps, { organizationId: orgId, linkId });
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT", reason: "property_not_approved" });
  });

  test("resume is refused when the program is now ineligible", async () => {
    const decision: EligibilityDecision = { decision: "deny", policyVersion: 1, reasons: ["contract"], checks: [] };
    const { deps, links } = setup({ decision });
    seededLink(links, "paused");
    const result = await resumeLinkAction(ctxFor(actorId), deps, { organizationId: orgId, linkId });
    expect(result).toEqual({ ok: false, code: "PROGRAM_INELIGIBLE", reasons: ["contract"] });
    expect(links.rows.get(linkId)?.link.status).toBe("paused");
  });

  test("resume re-checks the destination against the allow-list (spec §4.4)", async () => {
    const { deps, links } = setup({ hosts: [] });
    seededLink(links, "paused");
    const result = await resumeLinkAction(ctxFor(actorId), deps, { organizationId: orgId, linkId });
    expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED" });
    expect(links.rows.get(linkId)?.link.status).toBe("paused");
  });

  test("a stale version loses the compare-and-set on resume and writes nothing", async () => {
    const { deps, links } = setup();
    seededLink(links, "paused");
    const original = links.update.bind(links);
    links.update = async (write) => {
      links.rows.set(linkId, { ...write.record, link: { ...write.record.link, version: 99 } });
      return original(write);
    };
    expect(await resumeLinkAction(ctxFor(actorId), deps, { organizationId: orgId, linkId })).toEqual({
      ok: false,
      code: "STATE_CONFLICT",
    });
    expect(links.audits).toHaveLength(0);
  });

  test("a revoked link cannot resume, and reports STATE_CONFLICT before any property reason", async () => {
    const { deps, links } = setup({ status: "suspended" });
    seededLink(links, "revoked");
    expect(await resumeLinkAction(ctxFor(actorId), deps, { organizationId: orgId, linkId })).toEqual({
      ok: false,
      code: "STATE_CONFLICT",
    });
  });

  test("TP-W5-011: revoke makes the link revoked, and a revoked link cannot resume", async () => {
    const { deps, links } = setup();
    seededLink(links, "active");
    const revoked = await revokeLinkAction(ctxFor(actorId), deps, { organizationId: orgId, linkId });
    expect(revoked).toMatchObject({ ok: true, value: { status: "revoked", version: 3 } });

    const resumed = await resumeLinkAction(ctxFor(actorId), deps, { organizationId: orgId, linkId });
    expect(resumed).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("revoke is not blocked by a suspended property or an ineligible program", async () => {
    const decision: EligibilityDecision = { decision: "deny", policyVersion: 1, reasons: ["contract"], checks: [] };
    const { deps, links } = setup({ status: "suspended", decision });
    seededLink(links, "active");
    const result = await revokeLinkAction(ctxFor(actorId), deps, { organizationId: orgId, linkId });
    expect(result).toMatchObject({ ok: true, value: { status: "revoked" } });
  });

  test("a link of another tenant is RESOURCE_NOT_FOUND for every transition", async () => {
    const { deps, links } = setup();
    seededLink(links, "active");
    const scope = { organizationId: otherOrgId, linkId };
    expect(await pauseLinkAction(ctxFor(actorId), deps, scope)).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(await revokeLinkAction(ctxFor(actorId), deps, scope)).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(links.rows.get(linkId)?.link.status).toBe("active");
  });

  test("a stale version loses the compare-and-set on pause and writes nothing", async () => {
    const { deps, links } = setup();
    seededLink(links, "active");
    const original = links.update.bind(links);
    // Another writer moves the link between the read and the write.
    links.update = async (write) => {
      links.rows.set(linkId, { ...write.record, link: { ...write.record.link, version: 99 } });
      return original(write);
    };
    const result = await pauseLinkAction(ctxFor(actorId), deps, { organizationId: orgId, linkId });
    expect(result).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(links.audits).toHaveLength(0);
  });

  test("a caller that is not a user is UNAUTHENTICATED for pause, resume, and revoke", async () => {
    const { deps, links } = setup();
    seededLink(links, "active");
    const scope = { organizationId: orgId, linkId };
    expect(await pauseLinkAction(ctxFor(null), deps, scope)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(await resumeLinkAction(ctxFor(null), deps, scope)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(await revokeLinkAction(ctxFor(null), deps, scope)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });
});
