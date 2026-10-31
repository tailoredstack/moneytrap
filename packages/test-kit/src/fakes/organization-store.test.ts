import { describe, expect, test } from "bun:test";
import { fixtureId } from "../fixtures/ids";
import { FakeOrganizationStore } from "./organization-store";

const write = () => ({
  organization: {
    id: fixtureId("organization"),
    name: "Acme",
    country: "ES",
    baseCurrency: "EUR",
    status: "active" as const,
    createdBy: fixtureId("user"),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
  ownerMembership: { organizationId: fixtureId("organization"), userId: fixtureId("user"), role: "owner" as const },
});

describe("FakeOrganizationStore", () => {
  test("stores the organization and its owner membership", async () => {
    const store = new FakeOrganizationStore();
    await store.createWithOwner(write());
    expect(store.organizations).toHaveLength(1);
    expect(store.memberships).toHaveLength(1);
  });

  test("a failed membership write leaves no organization behind", async () => {
    const store = new FakeOrganizationStore();
    store.failMembership = true;
    await expect(store.createWithOwner(write())).rejects.toThrow("membership write failed");
    expect(store.organizations).toHaveLength(0);
    expect(store.memberships).toHaveLength(0);
  });
});
