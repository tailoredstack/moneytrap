import { describe, expect, test } from "bun:test";
import { type SyncCatalogResult, syncCatalog } from "@moneytrap/app/src/networks/sync-catalog";
import { type EligibilityInput, evaluateEligibility, type ProgramFactPayload } from "@moneytrap/domain";
import {
  FakeCatalogSyncStore,
  FakeClock,
  FakeIdGenerator,
  RECORDED_FIXTURES,
  type RecordedFixture,
  RecordedNetworkSimulator,
} from "@moneytrap/test-kit";

// Milestone M3 (wave 4): network connector, catalog, and eligibility. Each case drives the catalog sync (WP-4.6, WP-4.7)
// and the eligibility policy (WP-4.8) against the recorded-fixture simulator (WP-4.2). The simulator is the only
// upstream, so no case needs the real network adapter (WP-4.3).

const NETWORK = "net_sim";
const NOW = "2026-10-01T06:00:00.000Z";

function harness() {
  const store = new FakeCatalogSyncStore();
  const clock = new FakeClock(NOW);
  const ids = new FakeIdGenerator();
  const run = (connector: RecordedNetworkSimulator): Promise<SyncCatalogResult> =>
    syncCatalog({ connector, store, clock, ids }, { networkId: NETWORK });
  return { store, run };
}

function revisionsOf(store: FakeCatalogSyncStore, sourceId: string) {
  const fact = [...store.programs.entries()].find(([key]) => key.endsWith(`:${sourceId}`));
  return fact?.[1].revisions ?? [];
}

// The program as the catalog holds it after the sync, read fresh so the eligibility check runs on synced facts only.
function syncedProgram(store: FakeCatalogSyncStore, sourceId: string): ProgramFactPayload {
  const payload = revisionsOf(store, sourceId).at(-1)?.payload;
  if (!payload) throw new Error(`fixture: program ${sourceId} was not synced`);
  return payload;
}

// A property and publisher that are approved, so the only inputs left to decide are the program's facts and the
// geography and channel of the traffic. The contract permits every value the cases use, so it never decides on its own.
function eligibilityFor(program: ProgramFactPayload, geography: string, channel: string): EligibilityInput {
  return {
    publisher: { status: "approved" },
    property: { status: "approved" },
    program: { approval: program.approval, countries: program.countries, channels: program.channels },
    geography,
    channel,
    contract: { active: true, countries: ["US", "CA", "GB"], channels: ["website", "email", "sms"] },
    consent: { required: false, granted: false },
  };
}

describe("[M3] network conformance", () => {
  describe("CT-009 partner credential disabled", () => {
    test("sync requested with a disabled credential fails safely and writes no catalog fact", async () => {
      const { store, run } = harness();
      const connector = new RecordedNetworkSimulator("disabled-credential");

      const result = await run(connector);

      expect(result).toEqual({ ok: false, failure: { state: "not_authorized" } });
      expect(store.advertisers.size).toBe(0);
      expect(store.programs.size).toBe(0);
      expect(store.quarantined).toHaveLength(0);
      // The credential is checked first, so the sync never reads the catalog.
      expect(connector.requests).toEqual([{ operation: "validate_connection", cursor: null }]);
    });

    test("a program approved before the credential was disabled is not newly approved or re-revised", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));
      const revisionsBefore = revisionsOf(store, "prg-1").length;
      expect(syncedProgram(store, "prg-1").approval).toBe("approved");

      const result = await run(new RecordedNetworkSimulator("disabled-credential"));

      expect(result.ok).toBe(false);
      expect(revisionsOf(store, "prg-1")).toHaveLength(revisionsBefore);
      expect(syncedProgram(store, "prg-1").approval).toBe("approved");
    });
  });

  describe("CT-010 offer not permitted in user country or channel (eligibility half)", () => {
    test("an approved program that permits the country and channel is allowed", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));

      const decision = evaluateEligibility(eligibilityFor(syncedProgram(store, "prg-1"), "US", "website"));

      expect(decision.decision).toBe("allow");
    });

    test("a country the program does not permit is denied for geography", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));

      const decision = evaluateEligibility(eligibilityFor(syncedProgram(store, "prg-1"), "GB", "website"));

      expect(decision).toMatchObject({ decision: "deny", reasons: ["geography"] });
    });

    test("a channel the program does not list is denied for channel", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));

      const decision = evaluateEligibility(eligibilityFor(syncedProgram(store, "prg-1"), "US", "sms"));

      expect(decision).toMatchObject({ decision: "deny", reasons: ["channel"] });
    });

    test("a program with no approval state reported by the network is denied as unknown", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));
      const program = { ...syncedProgram(store, "prg-1"), approval: null };

      const decision = evaluateEligibility(eligibilityFor(program, "US", "website"));

      expect(decision).toMatchObject({ decision: "deny", reasons: ["unknown"] });
    });

    test("only the country and channel combinations the program lists are allowed", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));
      const program = syncedProgram(store, "prg-1");

      for (const geography of ["US", "CA", "GB", "AU", ""]) {
        for (const channel of ["website", "email", "sms", ""]) {
          const permitted = program.countries.includes(geography) && program.channels.includes(channel);
          const decision = evaluateEligibility(eligibilityFor(program, geography, channel));

          expect(decision.decision === "allow").toBe(permitted);
        }
      }
    });
  });

  describe("CT-015 malformed or unknown provider payload", () => {
    test("a program with no source identity is quarantined, never created, and the held record names its scope", async () => {
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

    test("an unknown payload field is counted and the record is still accepted", async () => {
      const { store, run } = harness();

      const result = await run(new RecordedNetworkSimulator("malformed-records"));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.unknownFields).toBe(1);
      expect(revisionsOf(store, "prg-4")).toHaveLength(1);
    });

    test("a program whose approval state the network did not report is quarantined, never approved", async () => {
      const base = RECORDED_FIXTURES["clean-catalog"];
      const fixture: RecordedFixture = {
        ...base,
        programs: [
          { ...base.programs[0], approval: "approved-ish" } as unknown as RecordedFixture["programs"][number],
          ...base.programs.slice(1),
        ],
      };
      const { store, run } = harness();

      const result = await run(new RecordedNetworkSimulator(fixture));

      expect(result.ok).toBe(true);
      expect(store.quarantined.map((held) => held.reason)).toEqual(["invalid_approval"]);
      expect(revisionsOf(store, "prg-1")).toHaveLength(0);
    });

    test("a repeat sync over the same malformed record holds it once, so no second alert is queued", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("malformed-records"));
      await run(new RecordedNetworkSimulator("malformed-records"));

      expect(store.quarantined).toHaveLength(1);
    });

    test("a callback with a forged signature is refused, and the same body with a valid signature is verified", async () => {
      const connector = new RecordedNetworkSimulator("clean-catalog");
      const body = '{"eventId":"evt-1"}';

      const forged = await connector.receiveNotification({ headers: { "x-sim-signature": "forged" }, body });
      const valid = await connector.receiveNotification({ headers: { "x-sim-signature": "sig-valid" }, body });

      expect(forged).toEqual({ ok: false, failure: { state: "not_authorized" } });
      expect(valid).toEqual({
        ok: true,
        value: { eventId: "evt-1", kind: "commission.updated", correlationId: "corr-1" },
      });
    });
  });
});
