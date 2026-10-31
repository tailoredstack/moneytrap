import { describe, expect, test } from "bun:test";
import { type SyncCatalogResult, syncCatalog } from "@moneytrap/app/src/networks/sync-catalog";
import {
  DENY_REASONS,
  type DenyReason,
  type EligibilityInput,
  evaluateEligibility,
  type ProgramFactPayload,
} from "@moneytrap/domain";
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

// TP-W4-021 exit criterion: at least 10,000 generated cases per run. The seed is fixed so a failing case reproduces.
const GENERATED_CASES = 10_000;
const GENERATED_SEED = 3159;

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

// One input to the policy, with every rule's facts set explicitly.
interface SweepCase {
  publisher: "approved" | "draft";
  property: "approved" | "draft";
  approval: ProgramFactPayload["approval"];
  contractActive: boolean;
  geography: string;
  channel: string;
  consent: { required: boolean; granted: boolean };
  contractCountries: readonly string[];
  contractChannels: readonly string[];
}

function sweepInput(program: ProgramFactPayload, c: SweepCase): EligibilityInput {
  return {
    publisher: { status: c.publisher },
    property: { status: c.property },
    program: { approval: c.approval, countries: program.countries, channels: program.channels },
    geography: c.geography,
    channel: c.channel,
    contract: { active: c.contractActive, countries: [...c.contractCountries], channels: [...c.contractChannels] },
    consent: c.consent,
  };
}

// The rules written out independently of the policy: allow only when every rule passes.
function expectedAllow(program: ProgramFactPayload, c: SweepCase): boolean {
  return (
    c.publisher === "approved" &&
    c.property === "approved" &&
    c.approval === "approved" &&
    c.contractActive &&
    program.countries.includes(c.geography) &&
    program.channels.includes(c.channel) &&
    c.contractCountries.includes(c.geography) &&
    c.contractChannels.includes(c.channel) &&
    (!c.consent.required || c.consent.granted)
  );
}

// The deny reasons the rules produce for a case, in the policy's own order. A blank geography or channel is unknown, and
// a value outside a list is that list's reason.
function expectedReasons(program: ProgramFactPayload, c: SweepCase): DenyReason[] {
  const reasons = new Set<DenyReason>();
  if (c.publisher !== "approved") reasons.add("publisher_not_approved");
  if (c.property !== "approved") reasons.add("property_not_approved");
  if (c.approval === null) reasons.add("unknown");
  else if (c.approval !== "approved") reasons.add("program_not_approved");
  if (!c.contractActive) reasons.add("contract");
  const dimension = (
    reason: "geography" | "channel",
    value: string,
    programValues: readonly string[],
    contractValues: readonly string[],
  ) => {
    if (value === "") reasons.add("unknown");
    else if (!programValues.includes(value) || !contractValues.includes(value)) reasons.add(reason);
  };
  dimension("geography", c.geography, program.countries, c.contractCountries);
  dimension("channel", c.channel, program.channels, c.contractChannels);
  if (c.consent.required && !c.consent.granted) reasons.add("consent");
  return DENY_REASONS.filter((reason) => reasons.has(reason));
}

function assertSweepCase(program: ProgramFactPayload, c: SweepCase): void {
  const decision = evaluateEligibility(sweepInput(program, c));
  // An allow has no reasons, so comparing reasons also compares allow with the rules. A wrong rule shows as a wrong list.
  expect(decision.decision === "allow" ? [] : decision.reasons).toEqual(expectedReasons(program, c));
  expect(decision.decision === "allow").toBe(expectedAllow(program, c));
}

// A seeded generator (mulberry32): the same seed gives the same sequence on every run.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)] as T;
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
      const connector = new RecordedNetworkSimulator("disabled-credential");

      const result = await run(connector);

      expect(result.ok).toBe(false);
      // Only the credential check is attempted. A sync that skipped it would also request the catalog here.
      expect(connector.requests).toEqual([{ operation: "validate_connection", cursor: null }]);
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
    test("TP-W4-015 an approved program that permits the country and channel is allowed, with evidence for every rule", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));

      const decision = evaluateEligibility(eligibilityFor(syncedProgram(store, "prg-1"), "US", "website"));

      expect(decision.decision).toBe("allow");
      // The evidence is the full list of checks, each passing, so an allow can be traced to every rule.
      expect(decision.checks).toEqual([
        { reason: "publisher_not_approved", passed: true },
        { reason: "property_not_approved", passed: true },
        { reason: "program_not_approved", passed: true },
        { reason: "contract", passed: true },
        { reason: "geography", passed: true },
        { reason: "channel", passed: true },
        { reason: "consent", passed: true },
      ]);
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

    test("TP-W4-019 a property that is not approved is denied for property_not_approved", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));
      const input: EligibilityInput = {
        ...eligibilityFor(syncedProgram(store, "prg-1"), "US", "website"),
        property: { status: "draft" },
      };

      const decision = evaluateEligibility(input);

      expect(decision).toMatchObject({ decision: "deny", reasons: ["property_not_approved"] });
    });

    test("TP-W4-020 consent not required in M3 is ignored: the same inputs allow without a consent grant", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("clean-catalog"));
      const base = eligibilityFor(syncedProgram(store, "prg-1"), "US", "website");
      // The base input carries consent that is not required and not granted, so no override is needed.
      expect(base.consent).toEqual({ required: false, granted: false });

      const decision = evaluateEligibility(base);

      expect(decision.decision).toBe("allow");
    });

    // The link half (a tracking link is created or resolved) needs the link create gate, which lands in WP-5.2.
    test.todo("[M4] CT-010 offer not permitted in user country or channel: link created or resolved");

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
      // The contract lists vary too: one permits both values used, the other permits only the second of each, so a
      // missing contract-side check changes at least one outcome.
      const contractCountries: readonly (readonly string[])[] = [["US", "GB"], ["GB"]];
      const contractChannels: readonly (readonly string[])[] = [["website", "sms"], ["sms"]];
      let cases = 0;

      // Exhaustive grid over the values the fixture uses.
      for (const publisher of statuses)
        for (const property of statuses)
          for (const approval of approvals)
            for (const contractActive of [true, false])
              for (const geography of ["US", "GB"])
                for (const channel of ["website", "sms"])
                  for (const consent of consents)
                    for (const countries of contractCountries)
                      for (const channels of contractChannels) {
                        assertSweepCase(program, {
                          publisher,
                          property,
                          approval,
                          contractActive,
                          geography,
                          channel,
                          consent,
                          contractCountries: countries,
                          contractChannels: channels,
                        });
                        cases++;
                      }
      const gridCases = 2 * 2 * 4 * 2 * 2 * 2 * 3 * 2 * 2;
      expect(cases).toBe(gridCases);

      // Generated cases over wider values, so the policy also sees values outside the grid.
      const random = seeded(GENERATED_SEED);
      const geographies = ["US", "GB", "CA", "AU", ""];
      const channels = ["website", "sms", "email", ""];
      for (let i = 0; i < GENERATED_CASES; i++) {
        assertSweepCase(program, {
          publisher: pick(random, statuses),
          property: pick(random, statuses),
          approval: pick(random, approvals),
          contractActive: random() < 0.5,
          geography: pick(random, geographies),
          channel: pick(random, channels),
          consent: pick(random, consents),
          contractCountries: pick(random, contractCountries),
          contractChannels: pick(random, contractChannels),
        });
        cases++;
      }
      expect(cases - gridCases).toBe(GENERATED_CASES);
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

    test("an invalid approval state is quarantined as invalid_approval, never approved", async () => {
      const { store, run } = harness();

      const result = await run(
        new RecordedNetworkSimulator(prg1With({ approval: "approved-ish" } as unknown as Partial<ProgramFactPayload>)),
      );

      expect(result.ok).toBe(true);
      expect(store.quarantined.map((held) => held.reason)).toEqual(["invalid_approval"]);
      expect(revisionsOf(store, "prg-1")).toHaveLength(0);
    });

    // The alert itself is an outbox event committed with the held record. The conformance fake does not model the outbox,
    // so this case asserts the held record is written once. The adapter test asserts the one outbox alert.
    test("TP-W4-010 a repeat sync over the same malformed record writes its held record once", async () => {
      const { store, run } = harness();
      await run(new RecordedNetworkSimulator("malformed-records"));
      await run(new RecordedNetworkSimulator("malformed-records"));

      expect(store.quarantined).toHaveLength(1);
    });

    // CT-015 covers callbacks as well as imports. The wave 4 test plan has no TP-W4 row for callback verification.
    test("CT-015 a callback with a forged signature is refused, and the same body with the valid signature is verified", async () => {
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
