import { describe, expect, test } from "bun:test";
import { syncCatalog } from "@moneytrap/app/src/networks/sync-catalog";
import { FakeClock } from "../clock";
import { FakeCatalogSyncStore } from "../fakes/catalog-sync-store";
import { FakeIdGenerator } from "../fakes/id-generator";
import { RECORDED_FIXTURES, type RecordedFixture } from "./fixtures";
import { RecordedNetworkSimulator } from "./simulator";

const NETWORK = "net_sim";
const FRESH_NOW = "2026-10-01T06:00:00.000Z";

function harness(now = FRESH_NOW) {
  const store = new FakeCatalogSyncStore();
  const clock = new FakeClock(now);
  const ids = new FakeIdGenerator();
  const run = (connector: RecordedNetworkSimulator) =>
    syncCatalog({ connector, store, clock, ids }, { networkId: NETWORK });
  return { store, run };
}

function revisionsOf(store: FakeCatalogSyncStore, sourceId: string) {
  const fact = [...store.programs.entries()].find(([key]) => key.endsWith(`:${sourceId}`));
  return fact?.[1].revisions ?? [];
}

describe("catalog sync (WP-4.6)", () => {
  test("TP-W4-005 every advertiser and program page is consumed and the watermark is stored", async () => {
    const { store, run } = harness();
    const result = await run(new RecordedNetworkSimulator("clean-catalog"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.advertisers.created).toBe(2);
    expect(result.value.programs.created).toBe(3);
    expect(result.value.watermark?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(result.value.dataStale).toBe(false);
    expect(await store.loadCursor(NETWORK, "advertisers")).toEqual({
      cursor: null,
      watermark: new Date("2026-10-01T00:00:00.000Z"),
    });
  });

  test("TP-W4-008 the same payload synced twice creates no new revisions", async () => {
    const { store, run } = harness();
    await run(new RecordedNetworkSimulator("clean-catalog"));
    const second = await run(new RecordedNetworkSimulator("clean-catalog"));

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.advertisers).toEqual({ created: 0, revised: 0, unchanged: 2, quarantined: 0 });
    expect(second.value.programs).toEqual({ created: 0, revised: 0, unchanged: 3, quarantined: 0 });
    expect(revisionsOf(store, "prg-1")).toHaveLength(1);
  });

  test("TP-W4-009 a changed commission is a new revision and the previous one is kept", async () => {
    const { store, run } = harness();
    await run(new RecordedNetworkSimulator("clean-catalog"));
    const result = await run(new RecordedNetworkSimulator("commission-change"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.programs.revised).toBe(1);
    const revisions = revisionsOf(store, "prg-1");
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.payload.terms).toBe("Commission 8% on net sales");
    expect(revisions[1]?.payload.terms).toBe("Commission 10% on net sales");
  });

  test("TP-W4-010 and CT-015 a program missing its source ID is quarantined and never created", async () => {
    const { store, run } = harness();
    const result = await run(new RecordedNetworkSimulator("malformed-records"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.programs.quarantined).toBe(1);
    expect(store.quarantined).toHaveLength(1);
    expect(store.quarantined[0]).toMatchObject({
      reason: "missing_identity",
      sourceId: null,
      scope: "programs:adv-100",
    });
    expect([...store.programs.keys()].some((key) => key.endsWith(":undefined"))).toBe(false);
  });

  test("a repeat run over the same malformed record holds it once, so no second alert is raised", async () => {
    const { store, run } = harness();
    await run(new RecordedNetworkSimulator("malformed-records"));
    await run(new RecordedNetworkSimulator("malformed-records"));

    expect(store.quarantined).toHaveLength(1);
  });

  test("TP-W4-011 an unknown payload field is counted and the record is still accepted", async () => {
    const { store, run } = harness();
    const result = await run(new RecordedNetworkSimulator("malformed-records"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unknownFields).toBe(1);
    expect([...store.programs.keys()].some((key) => key.endsWith(":prg-4"))).toBe(true);
  });

  test("CT-015 a program with an approval state the network did not report is quarantined, never approved", async () => {
    const base = RECORDED_FIXTURES["clean-catalog"];
    const fixture: RecordedFixture = {
      ...base,
      name: "clean-catalog",
      programs: [
        { ...base.programs[0], approval: "approved-ish" } as unknown as RecordedFixture["programs"][number],
        ...base.programs.slice(1),
      ],
    };
    const { store, run } = harness();
    const result = await run(new RecordedNetworkSimulator(fixture));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.quarantined.map((q) => q.reason)).toEqual(["invalid_approval"]);
    expect([...store.programs.keys()].some((key) => key.endsWith(":prg-1"))).toBe(false);
  });

  test("TP-W4-012 a program the network now reports as pending is stored as pending, not approved", async () => {
    const base = RECORDED_FIXTURES["clean-catalog"];
    const { store, run } = harness();
    await run(new RecordedNetworkSimulator("clean-catalog"));
    const pendingNow: RecordedFixture = {
      ...base,
      programs: base.programs.map((program) =>
        program.sourceId === "prg-1" ? { ...program, revision: "2", approval: "pending" } : program,
      ),
    };
    await run(new RecordedNetworkSimulator(pendingNow));

    expect(revisionsOf(store, "prg-1").at(-1)?.payload.approval).toBe("pending");
  });

  test("TP-W4-013 an interrupted sync resumes from the saved cursor without duplicate revisions", async () => {
    const { store, run } = harness();
    // One simulator for both runs: its interrupt fires once, so the second run continues past it.
    const upstream = new RecordedNetworkSimulator("sync-interrupt");
    const first = await run(upstream);

    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.failure.state).toBe("temporarily_unavailable");
    expect((await store.loadCursor(NETWORK, "programs:adv-200")).cursor).not.toBeNull();

    const second = await run(upstream);
    expect(second.ok).toBe(true);
    expect(upstream.requests.some((r) => r.operation === "discover_programs" && r.cursor !== null)).toBe(true);
    expect(revisionsOf(store, "prg-2")).toHaveLength(1);
    expect(revisionsOf(store, "prg-3")).toHaveLength(1);
  });

  test("TP-W4-002 and CT-009 a disabled credential stops the sync before any catalog write", async () => {
    const { store, run } = harness();
    const result = await run(new RecordedNetworkSimulator("disabled-credential"));

    expect(result).toEqual({ ok: false, failure: { state: "not_authorized" } });
    expect(store.advertisers.size).toBe(0);
    expect(store.programs.size).toBe(0);
    expect(await store.loadCursor(NETWORK, "advertisers")).toEqual({ cursor: null, watermark: null });
  });

  test("TP-W4-014 a watermark older than 24 hours marks the catalog data_stale", async () => {
    const { run } = harness("2026-10-03T00:00:00.000Z");
    const result = await run(new RecordedNetworkSimulator("clean-catalog"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dataStale).toBe(true);
  });
});
