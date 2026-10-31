import { describe, expect, test } from "bun:test";
import type { LinkAudit, LinkEvent, LinkRecord } from "@moneytrap/app/src/ports/link-store";
import { type EligibilityDecision, type Id, parseId } from "@moneytrap/domain";
import { FakeLinkStore } from "./link-store";

const orgId = parseId("organization", "org_01arz3ndektsv4rrffq69g5fav") as Id<"organization">;
const otherOrgId = parseId("organization", "org_01bx5zzkbkactav9wevgemmvrz") as Id<"organization">;
const propertyId = parseId("property", "prp_01arz3ndektsv4rrffq69g5fav") as Id<"property">;
const programId = parseId("program", "prg_01arz3ndektsv4rrffq69g5fav") as Id<"program">;
const linkId = parseId("link", "lnk_01arz3ndektsv4rrffq69g5fav") as Id<"link">;
const publisherId = parseId("publisher", "pub_01arz3ndektsv4rrffq69g5fav") as Id<"publisher">;
const auditId = parseId("audit", "aud_01arz3ndektsv4rrffq69g5fav") as Id<"audit">;
const eventId = parseId("event", "evt_01arz3ndektsv4rrffq69g5fav") as Id<"event">;

const allow: EligibilityDecision = { decision: "allow", policyVersion: 1, checks: [] };
const destination = "https://shop.example.com/item";

function record(): LinkRecord {
  return {
    link: {
      id: linkId,
      publisherId,
      propertyId,
      slug: linkId,
      destinationUrl: destination,
      status: "active",
      version: 1,
    },
    organizationId: orgId,
    programId,
  };
}

const audit: LinkAudit = {
  id: auditId,
  organizationId: orgId,
  actor: { type: "user", id: "usr_01arz3ndektsv4rrffq69g5fav" },
  action: "create",
  entityType: "link",
  entityId: linkId,
  metadata: {},
  occurredAt: new Date("2026-10-31T10:20:00.000Z"),
};
const event: LinkEvent = {
  id: eventId,
  topic: "link.created",
  aggregateId: linkId,
  aggregateVersion: 1,
  payload: {},
};

// A store with an approved property and an allowing decision for `orgId`, and one allowed host.
function approvedStore(hosts: readonly string[] = ["shop.example.com"]): FakeLinkStore {
  const store = new FakeLinkStore();
  store.setPropertyStatus(orgId, propertyId, "approved");
  store.setEligibility(orgId, propertyId, programId, allow);
  store.setAllowedHosts(programId, hosts);
  return store;
}

describe("FakeLinkStore precondition", () => {
  test("an insert is refused when another tenant holds the approval, and nothing is written", async () => {
    const store = approvedStore();
    const accepted = await store.insert({
      record: { ...record(), organizationId: otherOrgId },
      audit,
      event,
      precondition: { propertyId, programId, host: "shop.example.com" },
    });
    expect(accepted).toBe(false);
    expect(store.rows.size).toBe(0);
  });

  test("an entry with a different case still allows its host", async () => {
    const store = approvedStore(["Shop.Example.COM"]);
    const accepted = await store.insert({
      record: record(),
      audit,
      event,
      precondition: { propertyId, programId, host: "shop.example.com" },
    });
    expect(accepted).toBe(true);
  });

  test("an entry that carries a path matches no host", async () => {
    const store = approvedStore(["shop.example.com/evil"]);
    const accepted = await store.insert({
      record: record(),
      audit,
      event,
      precondition: { propertyId, programId, host: "shop.example.com" },
    });
    expect(accepted).toBe(false);
  });
});

describe("FakeLinkStore writes", () => {
  test("an insert never replaces an existing link ID", async () => {
    const store = approvedStore();
    const first = await store.insert({ record: record(), audit, event, precondition: null });
    const second = await store.insert({ record: record(), audit, event, precondition: null });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(store.audits).toHaveLength(1);
  });

  test("an update whose record names another tenant is refused", async () => {
    const store = approvedStore();
    await store.insert({ record: record(), audit, event, precondition: null });
    const accepted = await store.update({
      organizationId: orgId,
      expectedVersion: 1,
      record: { ...record(), organizationId: otherOrgId },
      audit,
      event,
      precondition: null,
    });
    expect(accepted).toBe(false);
  });
});
