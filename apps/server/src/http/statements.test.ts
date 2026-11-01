import { describe, expect, test } from "bun:test";
import { FakeStatementStore } from "@moneytrap/test-kit";
import { createApp } from "../app";
import { apiRoutes } from "./routes";

const auth = { handler: () => new Response("ok"), api: { getSession: async () => null } } as never;
const publisherId = "pub_01arz3ndektsv4rrffq69g5fav",
  organizationId = "org_01arz3ndektsv4rrffq69g5fav";
const record = {
  id: "stm_01arz3ndektsv4rrffq69g5fav",
  publisherId: publisherId as never,
  currency: "USD",
  periodStart: new Date("2026-10-01Z"),
  periodEnd: new Date("2026-11-01Z"),
  revision: 1,
  contentHash: "a".repeat(64),
  objectRef: "statements/one.json",
  content: {
    publisherId,
    currency: "USD",
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-11-01T00:00:00.000Z",
    asOf: "2026-11-01T00:00:00.000Z",
    totals: { estimatedMinor: "9", approvedMinor: "9", availableMinor: "9" },
    lines: [],
  },
  createdAt: new Date("2026-11-01Z"),
};

describe("statement API routes (TP-W6-049)", () => {
  test("serves stored statements and their detail", async () => {
    const store = new FakeStatementStore();
    await store.recordClosed(record as never);
    const app = createApp({ clock: { now: () => new Date() }, ids: { next: () => "x" } as never, readiness: [] }).use(
      apiRoutes(auth, undefined, undefined, undefined, undefined, undefined, {
        store: {
          findClosed: (...args) => store.findClosed(...args),
          recordClosed: (item) => store.recordClosed(item),
          list: (id) => store.list(id),
          listForOrganization: async (_user, org) => (org === organizationId ? [record as never] : []),
          findForOrganization: async (_user, org, id) =>
            org === organizationId && id === record.id ? (record as never) : null,
          downloadUrl: async (ref) => `https://files.example.test/${ref}`,
        },
        principal: async () => ({ userId: "u", memberships: [{ organizationId, role: "owner" }] }) as never,
      }),
    );
    const list = await app.handle(
      new Request(`http://localhost/v1/organizations/${organizationId}/statements?currency=USD`),
    );
    const detail = await app.handle(
      new Request(`http://localhost/v1/organizations/${organizationId}/statements/${record.id}/download`),
    );
    expect(list.status).toBe(200);
    expect((await list.json()).data[0].content_hash).toBe(record.contentHash);
    expect(detail.status).toBe(302);
    expect(detail.headers.get("location")).toBe(`https://files.example.test/${record.objectRef}`);
  });
  test("denies a caller without balances:read", async () => {
    const store = new FakeStatementStore();
    const app = createApp({ clock: { now: () => new Date() }, ids: { next: () => "x" } as never, readiness: [] }).use(
      apiRoutes(auth, undefined, undefined, undefined, undefined, undefined, {
        store: {
          findClosed: (...args) => store.findClosed(...args),
          recordClosed: (item) => store.recordClosed(item),
          list: (id) => store.list(id),
          downloadUrl: async (ref) => `https://files.example.test/${ref}`,
          listForOrganization: async () => [],
          findForOrganization: async () => record as never,
        },
        principal: async () => ({ userId: "u", memberships: [{ organizationId, role: "viewer" }] }) as never,
      }),
    );
    const response = await app.handle(new Request(`http://localhost/v1/organizations/${organizationId}/statements`));
    expect(response.status).toBe(403);
  });
  test("denies statement downloads to a viewer without balances:read", async () => {
    const store = new FakeStatementStore();
    const app = createApp({ clock: { now: () => new Date() }, ids: { next: () => "x" } as never, readiness: [] }).use(
      apiRoutes(auth, undefined, undefined, undefined, undefined, undefined, {
        store: {
          findClosed: (...args) => store.findClosed(...args),
          recordClosed: (item) => store.recordClosed(item),
          list: (id) => store.list(id),
          downloadUrl: async (ref) => `https://files.example.test/${ref}`,
          listForOrganization: async () => [],
          findForOrganization: async () => record as never,
        },
        principal: async () => ({ userId: "u", memberships: [{ organizationId, role: "viewer" }] }) as never,
      }),
    );
    const response = await app.handle(
      new Request(`http://localhost/v1/organizations/${organizationId}/statements/${record.id}/download`),
    );
    expect(response.status).toBe(403);
  });
  test("rejects malformed filters and unsupported currencies", async () => {
    const store = new FakeStatementStore();
    const app = createApp({ clock: { now: () => new Date() }, ids: { next: () => "x" } as never, readiness: [] }).use(
      apiRoutes(auth, undefined, undefined, undefined, undefined, undefined, {
        store: {
          findClosed: (...args) => store.findClosed(...args),
          recordClosed: (item) => store.recordClosed(item),
          list: (id) => store.list(id),
          downloadUrl: async (ref) => `https://files.example.test/${ref}`,
          listForOrganization: async () => [],
          findForOrganization: async () => record as never,
        },
        principal: async () => ({ userId: "u", memberships: [{ organizationId, role: "finance" }] }) as never,
      }),
    );
    for (const query of ["year=abc", "year=1e3", "year=2026.5", "month=13", "currency=XXX-NOPE", "currency="]) {
      const response = await app.handle(
        new Request(`http://localhost/v1/organizations/${organizationId}/statements?${query}`),
      );
      expect(response.status).toBe(400);
    }
  });
});
