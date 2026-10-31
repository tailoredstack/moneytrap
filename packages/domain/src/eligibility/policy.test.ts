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

    const countries = ["GB", "IE", "US", "FR"];
    const channels = ["web", "email", "social"];
    const statuses = ["approved", "draft", "suspended"] as const;
    const approvals = ["approved", "pending", "rejected", null] as const;

    for (let i = 0; i < 10_000; i++) {
      const generated = input({
        publisher: { status: pick(statuses) },
        property: { status: pick(statuses) },
        program: { approval: pick(approvals), countries: subset(countries), channels: subset(channels) },
        geography: pick(countries),
        channel: pick(channels),
        contract: { active: next() < 0.8, countries: subset(countries), channels: subset(channels) },
        consent: { required: next() < 0.3, granted: next() < 0.5 },
      });

      const expected =
        generated.publisher.status === "approved" &&
        generated.property.status === "approved" &&
        generated.program.approval === "approved" &&
        generated.contract.active &&
        generated.program.countries.includes(generated.geography) &&
        generated.contract.countries.includes(generated.geography) &&
        generated.program.channels.includes(generated.channel) &&
        generated.contract.channels.includes(generated.channel) &&
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
