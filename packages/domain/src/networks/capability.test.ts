import { describe, expect, test } from "bun:test";
import {
  CAPABILITY_STATES,
  type CapabilityProfile,
  CONNECTOR_OPERATIONS,
  isOperationAvailable,
  unavailableOperations,
} from "./capability";

const allSupported: CapabilityProfile = Object.fromEntries(
  CONNECTOR_OPERATIONS.map((operation) => [operation, "supported"]),
) as CapabilityProfile;

describe("connector operations (spec §6.1)", () => {
  test("lists every operation the connector contract defines", () => {
    expect([...CONNECTOR_OPERATIONS]).toEqual([
      "validate_connection",
      "discover_advertisers",
      "discover_programs",
      "resolve_tracking_destination",
      "list_transactions",
      "list_adjustments",
      "retrieve_settlement_evidence",
      "receive_notifications",
    ]);
  });

  test("the four capability states are supported, unsupported, temporarily_unavailable and not_authorized", () => {
    expect([...CAPABILITY_STATES]).toEqual(["supported", "unsupported", "temporarily_unavailable", "not_authorized"]);
  });
});

describe("capability profile (TP-W4-003, TP-W4-004)", () => {
  test("only a supported operation is available", () => {
    expect(isOperationAvailable(allSupported, "list_adjustments")).toBe(true);

    const profile = { ...allSupported, list_adjustments: "unsupported" } as CapabilityProfile;
    expect(isOperationAvailable(profile, "list_adjustments")).toBe(false);
  });

  test("temporarily_unavailable is not available, so callers do not read it as an empty result", () => {
    const profile = { ...allSupported, discover_advertisers: "temporarily_unavailable" } as CapabilityProfile;
    expect(isOperationAvailable(profile, "discover_advertisers")).toBe(false);
  });

  test("not_authorized is not available", () => {
    const profile = { ...allSupported, validate_connection: "not_authorized" } as CapabilityProfile;
    expect(isOperationAvailable(profile, "validate_connection")).toBe(false);
  });

  test("reports every operation that is not supported, with its state, so dependent features can show it", () => {
    const profile = {
      ...allSupported,
      list_adjustments: "unsupported",
      discover_programs: "temporarily_unavailable",
      receive_notifications: "not_authorized",
    } as CapabilityProfile;

    expect(unavailableOperations(profile)).toEqual([
      { operation: "discover_programs", state: "temporarily_unavailable" },
      { operation: "list_adjustments", state: "unsupported" },
      { operation: "receive_notifications", state: "not_authorized" },
    ]);
  });

  test("a fully supported profile has no unavailable operations", () => {
    expect(unavailableOperations(allSupported)).toEqual([]);
  });
});
