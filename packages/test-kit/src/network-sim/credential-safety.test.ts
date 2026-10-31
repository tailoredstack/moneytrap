import { describe, expect, test } from "bun:test";
import { syncCatalog } from "@moneytrap/app/src/networks/sync-catalog";
import type { ConnectorResult, NetworkConnector } from "@moneytrap/app/src/ports/network-connector";
import { FakeClock } from "../clock";
import { FakeCatalogSyncStore } from "../fakes/catalog-sync-store";
import { FakeIdGenerator } from "../fakes/id-generator";
import { RecordedNetworkSimulator } from "./simulator";

const NETWORK = "net_safety";
const SECRET = "sk_live_SENTINEL_CREDENTIAL_7f3a";

// An adapter that wrongly copies the upstream response, credential included, onto the failure object.
function leakingConnector(inner: NetworkConnector): NetworkConnector {
  return Object.assign(Object.create(inner), {
    async validateConnection(): Promise<ConnectorResult<never>> {
      const leaked = {
        state: "not_authorized",
        upstreamBody: `invalid api key ${SECRET}`,
        authorization: `Bearer ${SECRET}`,
      } as unknown as { state: "not_authorized" };
      return { ok: false, failure: leaked };
    },
  }) as NetworkConnector;
}

describe("disabled credential is a safe, typed failure (WP-4.7)", () => {
  test("TP-W4-002 the shipped disabled-credential fixture yields only the typed failure and writes nothing", async () => {
    const store = new FakeCatalogSyncStore();
    const result = await syncCatalog(
      {
        connector: new RecordedNetworkSimulator("disabled-credential"),
        store,
        clock: new FakeClock("2026-10-01T06:00:00.000Z"),
        ids: new FakeIdGenerator(),
      },
      { networkId: NETWORK },
    );

    expect(Object.keys(result)).toEqual(["ok", "failure"]);
    expect(result).toEqual({ ok: false, failure: { state: "not_authorized" } });
    expect(store.advertisers.size + store.programs.size + store.quarantined.length).toBe(0);
  });

  test("TP-W4-002 and CT-009 the failure is exactly the typed shape and carries no credential material", async () => {
    const store = new FakeCatalogSyncStore();
    const result = await syncCatalog(
      {
        connector: leakingConnector(new RecordedNetworkSimulator("disabled-credential")),
        store,
        clock: new FakeClock("2026-10-01T06:00:00.000Z"),
        ids: new FakeIdGenerator(),
      },
      { networkId: NETWORK },
    );

    expect(result).toEqual({ ok: false, failure: { state: "not_authorized" } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(store.advertisers.size).toBe(0);
    expect(store.programs.size).toBe(0);
    expect(store.quarantined).toHaveLength(0);
  });

  test("TP-W4-007 a temporarily_unavailable failure keeps only its retry-after value", async () => {
    const inner = new RecordedNetworkSimulator("clean-catalog");
    const connector = Object.assign(Object.create(inner), {
      async discoverAdvertisers() {
        return {
          ok: false,
          failure: {
            state: "temporarily_unavailable",
            retryAfterSeconds: 30,
            upstreamBody: SECRET,
          } as unknown as { state: "temporarily_unavailable"; retryAfterSeconds: number },
        };
      },
    }) as NetworkConnector;
    const result = await syncCatalog(
      {
        connector,
        store: new FakeCatalogSyncStore(),
        clock: new FakeClock("2026-10-01T06:00:00.000Z"),
        ids: new FakeIdGenerator(),
      },
      { networkId: NETWORK },
    );

    expect(result).toEqual({
      ok: false,
      failure: { state: "temporarily_unavailable", retryAfterSeconds: 30 },
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
