import { describe, expect, test } from "bun:test";
import { fixtureId } from "../fixtures/ids";
import { FakeProgramApprovalStore } from "./program-approval-store";

const programId = "prg_fixture_one";
const orgId = fixtureId("organization", 1);
const otherOrgId = fixtureId("organization", 2);
const propertyId = fixtureId("property", 1);

const write = () => ({
  organizationId: orgId,
  propertyId,
  programId,
  requestedAt: new Date(0),
  actor: { type: "user", id: fixtureId("user", 1) as string },
  audit: { id: fixtureId("audit", 1), metadata: {} },
  event: { id: fixtureId("event", 1), payload: {} },
});

describe("FakeProgramApprovalStore", () => {
  test("a property owned by another organization writes nothing", async () => {
    const store = new FakeProgramApprovalStore();
    store.properties.set(propertyId, otherOrgId);
    store.programs.set(programId, null);

    expect((await store.request(write())).kind).toBe("unknown_property");
    expect(store.requests.size).toBe(0);
  });

  test("a second request for the same pair returns the stored one and writes no audit", async () => {
    const store = new FakeProgramApprovalStore();
    store.properties.set(propertyId, orgId);
    store.programs.set(programId, "pending");

    expect((await store.request(write())).kind).toBe("recorded");
    expect((await store.request(write())).kind).toBe("existing");
    expect(store.audits).toHaveLength(1);
    expect(store.events).toHaveLength(1);
  });

  test("find reports the approval the network last set, and only inside the owning organization", async () => {
    const store = new FakeProgramApprovalStore();
    store.properties.set(propertyId, orgId);
    store.programs.set(programId, null);
    await store.request(write());

    store.setNetworkApproval(programId, "approved");
    expect((await store.find(orgId, propertyId, programId))?.networkApproval).toBe("approved");
    expect(await store.find(otherOrgId, propertyId, programId)).toBeNull();
  });
});
