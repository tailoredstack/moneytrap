import { describe, expect, test } from "bun:test";
import type { ProgramFactPayload } from "../catalog/source-fact";
import { ELIGIBILITY_POLICY_VERSION, type EligibilityInput, evaluateEligibility } from "./policy";

const program: Pick<ProgramFactPayload, "approval" | "countries" | "channels"> = {
  approval: "approved",
  countries: ["GB", "IE"],
  channels: ["web", "email"],
};

function input(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    publisher: { status: "approved" },
    property: { status: "approved" },
    program,
    geography: "GB",
    channel: "web",
    contract: { active: true, countries: ["GB", "IE", "US"], channels: ["web", "email", "social"] },
    consent: { required: false, granted: false },
    ...overrides,
  };
}

describe("evaluateEligibility (TP-W4-015 to TP-W4-020)", () => {
  test("TP-W4-015: approved program, allowed country and channel, approved property allows with evidence", () => {
    const result = evaluateEligibility(input());
    expect(result.decision).toBe("allow");
    expect(result.policyVersion).toBe(ELIGIBILITY_POLICY_VERSION);
    expect(result.checks.every((check) => check.passed)).toBe(true);
    expect(result.checks.map((check) => check.reason)).toContain("geography");
  });

  test("TP-W4-016: property country not in the program list denies with geography", () => {
    const result = evaluateEligibility(input({ geography: "US" }));
    expect(result.decision).toBe("deny");
    expect(result.decision === "deny" && result.reasons).toEqual(["geography"]);
  });

  test("TP-W4-016: property country not in the contract denies with geography", () => {
    const result = evaluateEligibility(input({ geography: "FR", program: { ...program, countries: ["FR"] } }));
    expect(result.decision === "deny" && result.reasons).toEqual(["geography"]);
  });

  test("TP-W4-017: channel not in the program list denies with channel", () => {
    const result = evaluateEligibility(input({ channel: "social", program: { ...program, channels: ["web"] } }));
    expect(result.decision === "deny" && result.reasons).toEqual(["channel"]);
  });

  test("TP-W4-018: unknown program approval denies with unknown", () => {
    const result = evaluateEligibility(input({ program: { ...program, approval: null } }));
    expect(result.decision === "deny" && result.reasons).toEqual(["unknown"]);
  });

  test("a pending or rejected program approval denies with program_not_approved", () => {
    for (const approval of ["pending", "rejected"] as const) {
      const result = evaluateEligibility(input({ program: { ...program, approval } }));
      expect(result.decision === "deny" && result.reasons).toEqual(["program_not_approved"]);
    }
  });

  test("TP-W4-019: property not approved denies with property_not_approved", () => {
    const result = evaluateEligibility(input({ property: { status: "verified" } }));
    expect(result.decision === "deny" && result.reasons).toEqual(["property_not_approved"]);
  });

  test("a suspended publisher denies with publisher_not_approved", () => {
    const result = evaluateEligibility(input({ publisher: { status: "suspended" } }));
    expect(result.decision === "deny" && result.reasons).toEqual(["publisher_not_approved"]);
  });

  test("an inactive contract denies with contract", () => {
    const result = evaluateEligibility(input({ contract: { active: false, countries: ["GB"], channels: ["web"] } }));
    expect(result.decision === "deny" && result.reasons).toEqual(["contract"]);
  });

  test("TP-W4-020: consent is ignored when not required (Optimize off in M3)", () => {
    const result = evaluateEligibility(input({ consent: { required: false, granted: false } }));
    expect(result.decision).toBe("allow");
  });

  test("consent required but not granted denies with consent", () => {
    const result = evaluateEligibility(input({ consent: { required: true, granted: false } }));
    expect(result.decision === "deny" && result.reasons).toEqual(["consent"]);
  });

  test("every failing rule is reported, in a fixed order", () => {
    const result = evaluateEligibility(
      input({
        property: { status: "draft" },
        geography: "US",
        channel: "social",
        consent: { required: true, granted: false },
      }),
    );
    expect(result.decision === "deny" && result.reasons).toEqual([
      "property_not_approved",
      "geography",
      "channel",
      "consent",
    ]);
  });

  test("a blank property country is unknown and denies", () => {
    const result = evaluateEligibility(input({ geography: "  " }));
    expect(result.decision === "deny" && result.reasons).toEqual(["unknown"]);
  });

  test("an empty program country list denies, because nothing is permitted", () => {
    const result = evaluateEligibility(input({ program: { ...program, countries: [] } }));
    expect(result.decision === "deny" && result.reasons).toEqual(["geography"]);
  });

  test("country and channel comparison ignores case and surrounding spaces", () => {
    const result = evaluateEligibility(
      input({ geography: " gb ", channel: "WEB", program: { ...program, countries: ["GB"], channels: ["Web"] } }),
    );
    expect(result.decision).toBe("allow");
  });
});

// TP-W4-021: allow only when every rule passes. The expectation below is written independently of the implementation,
// so a regression in either direction is caught. The generator is seeded, so each run covers the same 10,000 cases.
// Malformed facts from a quarantined payload must deny, never throw or allow (unknown = deny).
describe("evaluateEligibility fails closed on malformed input", () => {
  test("a consent flag that is missing at runtime needs consent", () => {
    const result = evaluateEligibility(input({ consent: {} as EligibilityInput["consent"] }));
    expect(result.decision === "deny" && result.reasons).toEqual(["consent"]);
  });

  test("a null program country list denies with geography instead of throwing", () => {
    const result = evaluateEligibility(
      input({ program: { ...program, countries: null as unknown as readonly string[] } }),
    );
    expect(result.decision === "deny" && result.reasons).toEqual(["geography"]);
  });

  test("a null or missing top-level section denies instead of throwing", () => {
    const sections = ["publisher", "property", "program", "contract", "consent"] as const;
    for (const section of sections) {
      for (const missing of [null, undefined]) {
        const result = evaluateEligibility({ ...input(), [section]: missing } as unknown as EligibilityInput);
        expect(result.decision).toBe("deny");
      }
    }
  });

  test("a truthy but non-boolean contract flag does not count as active", () => {
    for (const active of [1, "true", {}]) {
      const result = evaluateEligibility(
        input({ contract: { active, countries: ["GB"], channels: ["web"] } as never }),
      );
      expect(result.decision === "deny" && result.reasons).toEqual(["contract"]);
    }
  });

  test("a non-string geography or channel denies as unknown instead of throwing", () => {
    const geography = evaluateEligibility(input({ geography: 826 as unknown as string }));
    expect(geography.decision === "deny" && geography.reasons).toEqual(["unknown"]);
    const channel = evaluateEligibility(input({ channel: null as unknown as string }));
    expect(channel.decision === "deny" && channel.reasons).toEqual(["unknown"]);
  });

  test("a non-string entry in a contract channel list is not a match", () => {
    const result = evaluateEligibility(
      input({ contract: { active: true, countries: ["GB"], channels: [null, 7] as unknown as string[] } }),
    );
    expect(result.decision === "deny" && result.reasons).toEqual(["channel"]);
  });
});

describe("evaluateEligibility property (TP-W4-021)", () => {
  test("allow exactly when every rule passes, over 10,000 generated cases", () => {
    let seed = 20260101;
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
    const subset = (items: readonly string[]) => items.filter(() => next() < 0.5);
    // Half the values come back with mixed case and surrounding spaces, so normalisation is part of every run.
    const vary = (value: string) => (next() < 0.5 ? ` ${value.toLowerCase()} ` : value.toUpperCase());
    const varyAll = (values: readonly string[]) => values.map(vary);
    // The expectation normalises the same way on both sides, without calling the implementation's helper.
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const listed = (values: readonly string[], value: string) => values.some((candidate) => same(candidate, value));

    const countries = ["GB", "IE", "US", "FR"];
    const channels = ["web", "email", "social"];
    const statuses = ["approved", "draft", "suspended"] as const;
    const approvals = ["approved", "pending", "rejected", null] as const;

    for (let i = 0; i < 10_000; i++) {
      const generated = input({
        publisher: { status: pick(statuses) },
        property: { status: pick(statuses) },
        program: {
          approval: pick(approvals),
          countries: varyAll(subset(countries)),
          channels: varyAll(subset(channels)),
        },
        geography: vary(pick(countries)),
        channel: vary(pick(channels)),
        contract: { active: next() < 0.8, countries: varyAll(subset(countries)), channels: varyAll(subset(channels)) },
        consent: { required: next() < 0.3, granted: next() < 0.5 },
      });

      const expected =
        generated.publisher.status === "approved" &&
        generated.property.status === "approved" &&
        generated.program.approval === "approved" &&
        generated.contract.active &&
        listed(generated.program.countries, generated.geography) &&
        listed(generated.contract.countries, generated.geography) &&
        listed(generated.program.channels, generated.channel) &&
        listed(generated.contract.channels, generated.channel) &&
        (!generated.consent.required || generated.consent.granted);

      const result = evaluateEligibility(generated);
      if (expected) {
        expect(result.decision).toBe("allow");
      } else {
        expect(result.decision).toBe("deny");
        expect(result.decision === "deny" && result.reasons.length).toBeGreaterThan(0);
      }
    }
  });
});
