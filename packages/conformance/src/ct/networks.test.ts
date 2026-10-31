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
const clean = RECORDED_FIXTURES["clean-catalog"];

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

// A fixture that differs from the clean catalog only in prg-1's revision and approval state.
function prg1With(overrides: Partial<(typeof clean.programs)[number]>): RecordedFixture {
  return {
    ...clean,
    programs: [{ ...clean.programs[0], ...overrides }, ...clean.programs.slice(1)],
  } as RecordedFixture;
}

// Every rule except the one under test passes: publisher and property approved, program approved, contract in force
// and permitting the values used, consent not required. Cases override one field at a time.
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
  describe("[M3] CT-009 partner credential disabled", () => {
    test("TP-W4-002 sync requested with a disabled credential fails safely and writes no catalog fact", async () => {
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

    test("TP-W4-012 a program previously approved that the network now reports as pending is not approved", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));
      const approvedRevision = revisionsOf(store, "prg-1")[0];
      expect(approvedRevision?.payload.approval).toBe("approved");

      const result = await run(new RecordedNetworkSimulator(prg1With({ revision: "2", approval: "pending" })));

      expect(result.ok).toBe(true);
      // The pending state is recorded as a new revision. The earlier approved revision is kept, not extended or rewritten.
      expect(revisionsOf(store, "prg-1")).toHaveLength(2);
      expect(revisionsOf(store, "prg-1")[0]).toEqual(approvedRevision);
      expect(syncedProgram(store, "prg-1").approval).toBe("pending");
      const decision = evaluateEligibility(eligibilityFor(syncedProgram(store, "prg-1"), "US", "website"));
      expect(decision).toMatchObject({ decision: "deny", reasons: ["program_not_approved"] });
    });
  });

  describe("[M3] CT-010 offer not permitted in user country or channel (eligibility half)", () => {
    test("TP-W4-015 an approved program that permits the country and channel is allowed", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));

      const decision = evaluateEligibility(eligibilityFor(syncedProgram(store, "prg-1"), "US", "website"));

      expect(decision.decision).toBe("allow");
    });

    test("TP-W4-016 a country the program does not permit is denied for geography", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));

      const decision = evaluateEligibility(eligibilityFor(syncedProgram(store, "prg-1"), "GB", "website"));

      expect(decision).toMatchObject({ decision: "deny", reasons: ["geography"] });
    });

    test("TP-W4-017 a channel the program does not list is denied for channel", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));

      const decision = evaluateEligibility(eligibilityFor(syncedProgram(store, "prg-1"), "US", "sms"));

      expect(decision).toMatchObject({ decision: "deny", reasons: ["channel"] });
    });

    test("TP-W4-018 a program whose approval the network did not report is denied as unknown", async () => {
      const { store, run } = harness();
      const result = await run(new RecordedNetworkSimulator(prg1With({ revision: "2", approval: null })));

      expect(result.ok).toBe(true);
      expect(syncedProgram(store, "prg-1").approval).toBeNull();
      const decision = evaluateEligibility(eligibilityFor(syncedProgram(store, "prg-1"), "US", "website"));
      expect(decision).toMatchObject({ decision: "deny", reasons: ["unknown"] });
    });

    test("TP-W4-021 allow only when every rule passes, across publisher, property, approval, contract, geography, channel, and consent", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));
      const program = syncedProgram(store, "prg-1");
      const statuses = ["approved", "draft"] as const;
      const approvals = ["approved", "pending", "rejected", null] as const;
      const consents = [
        { required: false, granted: false },
        { required: true, granted: false },
        { required: true, granted: true },
      ] as const;
      let cases = 0;

      for (const publisher of statuses)
        for (const property of statuses)
          for (const approval of approvals)
            for (const active of [true, false])
              for (const geography of ["US", "GB"])
                for (const channel of ["website", "sms"])
                  for (const consent of consents) {
                    const input: EligibilityInput = {
                      publisher: { status: publisher },
                      property: { status: property },
                      program: { approval, countries: program.countries, channels: program.channels },
                      geography,
                      channel,
                      contract: { active, countries: ["US", "GB"], channels: ["website", "sms"] },
                      consent,
                    };
                    const permitted =
                      publisher === "approved" &&
                      property === "approved" &&
                      approval === "approved" &&
                      active &&
                      program.countries.includes(geography) &&
                      program.channels.includes(channel) &&
                      (!consent.required || consent.granted);
                    const decision = evaluateEligibility(input);

                    expect(decision.decision === "allow").toBe(permitted);
                    if (decision.decision === "deny") expect(decision.reasons.length).toBeGreaterThan(0);
                    cases++;
                  }

      expect(cases).toBe(2 * 2 * 4 * 2 * 2 * 2 * 3);
    });
  });

  describe("[M3] CT-015 malformed or unknown provider payload", () => {
    test("TP-W4-010 a program with no source identity is quarantined, never created, and the held record names its scope", async () => {
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

    test("TP-W4-011 an unknown payload field is counted and the record is still accepted", async () => {
      const { store, run } = harness();

      const result = await run(new RecordedNetworkSimulator("malformed-records"));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.unknownFields).toBe(1);
      expect(revisionsOf(store, "prg-4")).toHaveLength(1);
    });

    test("a program whose approval state the network did not report is quarantined, never approved", async () => {
      const { store, run } = harness();

      const result = await run(
        new RecordedNetworkSimulator(prg1With({ approval: "approved-ish" } as unknown as Partial<ProgramFactPayload>)),
      );

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

    test("a callback with a forged signature is refused, and the same body with the valid signature is verified", async () => {
      const connector = new RecordedNetworkSimulator("clean-catalog");
      const body = '{"eventId":"evt-1"}';

      const forged = await connector.receiveNotification({ headers: { "x-sim-signature": "forged" }, body });
      const valid = await connector.receiveNotification({
        headers: { "x-sim-signature": clean.notification.signature },
        body,
      });

      expect(forged).toEqual({ ok: false, failure: { state: "not_authorized" } });
      expect(valid).toEqual({ ok: true, value: clean.notification.event });
    });
  });
});
