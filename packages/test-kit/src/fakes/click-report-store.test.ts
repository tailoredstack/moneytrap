import { describe, expect, test } from "bun:test";
import type { Id } from "@moneytrap/domain";
import { FakeClickReportStore } from "./click-report-store";

const orgA = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const orgB = "org_01brz3ndektsv4rrffq69g5fav" as Id<"organization">;
const linkA = "lnk_01arz3ndektsv4rrffq69g5fa1";
const linkB = "lnk_01arz3ndektsv4rrffq69g5fa2";
const linkForeign = "lnk_01arz3ndektsv4rrffq69g5fa9";
const from = new Date("2026-10-01T00:00:00.000Z");
const to = new Date("2026-11-01T00:00:00.000Z");

// The fake applies the same rules as the Postgres report store, so the app tests can rely on its behaviour.
describe("FakeClickReportStore (WP-5.9 port fake)", () => {
  function seeded(): FakeClickReportStore {
    const store = new FakeClickReportStore();
    store.seedLink(linkA, orgA);
    store.seedLink(linkB, orgA);
    store.seedLink(linkForeign, orgB);
    store.seedClick(linkA, from); // counts: the window starts at from
    store.seedClick(linkA, new Date("2026-10-15T00:00:00.000Z"));
    store.seedClick(linkA, to); // does not count: the window ends before to
    store.seedClick(linkB, new Date("2026-10-20T00:00:00.000Z"));
    store.seedClick(linkForeign, new Date("2026-10-20T00:00:00.000Z"));
    return store;
  }

  test("counts only the organization's links, inside the half-open window", async () => {
    const rows = await seeded().countByLink({ organizationId: orgA, from, to, afterLinkId: null, limit: 10 });
    expect(rows).toEqual([
      { linkId: linkA, clicks: 2 },
      { linkId: linkB, clicks: 1 },
    ]);
  });

  test("pages in link ID order and resumes after the cursor", async () => {
    const store = seeded();
    const first = await store.countByLink({ organizationId: orgA, from, to, afterLinkId: null, limit: 1 });
    expect(first.map((row) => row.linkId)).toEqual([linkA]);
    const second = await store.countByLink({ organizationId: orgA, from, to, afterLinkId: linkA, limit: 1 });
    expect(second.map((row) => row.linkId)).toEqual([linkB]);
  });

  test("recordedDelayMs is the largest occurred-to-recorded gap of the organization's recent clicks, or null", async () => {
    const store = new FakeClickReportStore();
    store.seedLink(linkA, orgA);
    store.seedLink(linkForeign, orgB);
    store.seedClick(linkA, new Date("2026-10-31T00:00:00.000Z"), new Date("2026-10-31T00:00:05.000Z"));
    store.seedClick(linkA, new Date("2026-10-30T00:00:00.000Z"), new Date("2026-10-31T06:00:00.000Z"));
    store.seedClick(linkForeign, new Date("2026-10-30T00:00:00.000Z"), new Date("2026-11-01T00:00:00.000Z"));
    expect(await store.recordedDelayMs(orgA, from)).toBe(30 * 60 * 60 * 1000);
    expect(await store.recordedDelayMs(orgA, new Date("2026-11-01T00:00:00.000Z"))).toBeNull();
    expect(await store.recordedDelayMs(orgB, from)).toBe(2 * 24 * 60 * 60 * 1000);
  });
});
