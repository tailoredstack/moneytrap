import { describe, expect, test } from "bun:test";
import { type CapabilityProfile, CONNECTOR_OPERATIONS, type ConnectorOperation } from "@moneytrap/domain";
import { FakeNetworkConnector } from "./network-connector";

const profile = (overrides: Partial<Record<ConnectorOperation, CapabilityProfile[ConnectorOperation]>> = {}) =>
  Object.fromEntries(
    CONNECTOR_OPERATIONS.map((operation) => [operation, overrides[operation] ?? "supported"]),
  ) as CapabilityProfile;

describe("FakeNetworkConnector (WP-4.1)", () => {
  test("TP-W4-001 validate connection returns the capability profile for a valid credential", async () => {
    const connector = new FakeNetworkConnector({ capabilities: profile() });

    const result = await connector.validateConnection();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.capabilities).toEqual(profile());
  });

  test("TP-W4-002 a disabled credential is reported as not_authorized", async () => {
    const connector = new FakeNetworkConnector({ failures: { validate_connection: { state: "not_authorized" } } });

    expect(await connector.validateConnection()).toEqual({ ok: false, failure: { state: "not_authorized" } });
  });

  test("TP-W4-003 an unsupported operation fails as unsupported, not as an empty list", async () => {
    const connector = new FakeNetworkConnector({
      capabilities: profile({ list_adjustments: "unsupported" }),
      failures: { list_adjustments: { state: "unsupported" } },
    });

    expect(await connector.listAdjustments({ from: new Date(0), to: new Date(1), cursor: null })).toEqual({
      ok: false,
      failure: { state: "unsupported" },
    });
  });

  test("an operation the profile marks unsupported fails even with no explicit failure set", async () => {
    const connector = new FakeNetworkConnector({ capabilities: profile({ list_transactions: "not_authorized" }) });

    expect(await connector.listTransactions({ from: new Date(0), to: new Date(1), cursor: null })).toEqual({
      ok: false,
      failure: { state: "not_authorized" },
    });
  });

  test("validate connection still returns the profile when it marks an operation unsupported", async () => {
    const connector = new FakeNetworkConnector({ capabilities: profile({ list_adjustments: "unsupported" }) });

    const result = await connector.validateConnection();

    expect(result.ok && result.value.capabilities.list_adjustments).toBe("unsupported");
  });

  test("TP-W4-004 temporarily_unavailable carries a retry hint and never returns an empty page", async () => {
    const connector = new FakeNetworkConnector({
      failures: { discover_advertisers: { state: "temporarily_unavailable", retryAfterSeconds: 30 } },
    });

    const result = await connector.discoverAdvertisers({ cursor: null });

    expect(result).toEqual({
      ok: false,
      failure: { state: "temporarily_unavailable", retryAfterSeconds: 30 },
    });
  });

  test("a notification with an unverified signature is refused as not_authorized", async () => {
    const connector = new FakeNetworkConnector({ signatureValid: false });

    expect(await connector.receiveNotification({ headers: {}, body: "{}" })).toEqual({
      ok: false,
      failure: { state: "not_authorized" },
    });
  });

  test("records each operation it is asked to run, in order", async () => {
    const connector = new FakeNetworkConnector({ capabilities: profile() });

    await connector.validateConnection();
    await connector.discoverAdvertisers({ cursor: null });

    expect(connector.calls).toEqual(["validate_connection", "discover_advertisers"]);
  });
});
