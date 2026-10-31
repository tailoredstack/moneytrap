import { describe, expect, test } from "bun:test";
import { type SyncCatalogResult, syncCatalog } from "@moneytrap/app/src/networks/sync-catalog";
import type { NetworkConnector } from "@moneytrap/app/src/ports/network-connector";
import { FakeClock } from "../clock";
import { FakeCatalogSyncStore } from "../fakes/catalog-sync-store";
import { FakeIdGenerator } from "../fakes/id-generator";
import { RecordedNetworkSimulator } from "./simulator";

const NETWORK = "net_safety";
const SECRET = "sk_live_SENTINEL_CREDENTIAL_7f3a";

type Overrides = Partial<Pick<NetworkConnector, "validateConnection" | "discoverAdvertisers" | "discoverPrograms">>;

// A connector that replaces selected operations. Every other call goes to the recorded simulator.
function withOverrides(inner: NetworkConnector, overrides: Overrides): NetworkConnector {
  return Object.assign(Object.create(inner), overrides) as NetworkConnector;
}

// A failure carrying the credential in fields the port does not define, as a careless adapter would return it.
function leakingFailure(state: string, extra: Record<string, unknown> = {}): never {
  return { state, upstreamBody: `invalid api key ${SECRET}`, authorization: `Bearer ${SECRET}`, ...extra } as never;
}

async function run(connector: NetworkConnector, store = new FakeCatalogSyncStore()): Promise<SyncCatalogResult> {
  return syncCatalog(
    { connector, store, clock: new FakeClock("2026-10-01T06:00:00.000Z"), ids: new FakeIdGenerator() },
    { networkId: NETWORK },
  );
}

describe("disabled credential is a safe, typed failure (WP-4.7)", () => {
  test("TP-W4-002 the shipped disabled-credential fixture yields only the typed failure and writes nothing", async () => {
    const store = new FakeCatalogSyncStore();
    const result = await run(new RecordedNetworkSimulator("disabled-credential"), store);

    expect(Object.keys(result)).toEqual(["ok", "failure"]);
    expect(result).toEqual({ ok: false, failure: { state: "not_authorized" } });
    expect(store.advertisers.size + store.programs.size + store.quarantined.length).toBe(0);
  });

  test("TP-W4-002 and CT-009 a leaking not_authorized failure is reduced to the typed shape", async () => {
    const store = new FakeCatalogSyncStore();
    const connector = withOverrides(new RecordedNetworkSimulator("disabled-credential"), {
      validateConnection: async () => ({ ok: false, failure: leakingFailure("not_authorized") }),
    });
    const result = await run(connector, store);

    expect(result).toEqual({ ok: false, failure: { state: "not_authorized" } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(store.advertisers.size).toBe(0);
    expect(store.programs.size).toBe(0);
  });

  test("TP-W4-007 an unsupported failure keeps only its state", async () => {
    const connector = withOverrides(new RecordedNetworkSimulator("clean-catalog"), {
      discoverAdvertisers: async () => ({ ok: false, failure: leakingFailure("unsupported") }),
    });
    const result = await run(connector);

    expect(result).toEqual({ ok: false, failure: { state: "unsupported" } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  test("TP-W4-007 a temporarily_unavailable failure keeps only its retry-after value", async () => {
    const connector = withOverrides(new RecordedNetworkSimulator("clean-catalog"), {
      discoverAdvertisers: async () => ({
        ok: false,
        failure: leakingFailure("temporarily_unavailable", { retryAfterSeconds: 30 }),
      }),
    });
    const result = await run(connector);

    expect(result).toEqual({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: 30 } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  test("TP-W4-007 a retry-after that is not a finite non-negative number is dropped to null", async () => {
    for (const retryAfterSeconds of [Number.NaN, Number.POSITIVE_INFINITY, -5, "30" as unknown as number, null]) {
      const connector = withOverrides(new RecordedNetworkSimulator("clean-catalog"), {
        discoverAdvertisers: async () => ({
          ok: false,
          failure: leakingFailure("temporarily_unavailable", { retryAfterSeconds }),
        }),
      });
      const result = await run(connector);

      expect(result).toEqual({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: null } });
    }
  });

  test("TP-W4-007 an unrecognized state is reported as not_authorized, never passed through", async () => {
    const connector = withOverrides(new RecordedNetworkSimulator("clean-catalog"), {
      discoverAdvertisers: async () => ({ ok: false, failure: leakingFailure(`upstream said ${SECRET}`) }),
    });
    const result = await run(connector);

    expect(result).toEqual({ ok: false, failure: { state: "not_authorized" } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  test("TP-W4-007 a failure on the program pass is reduced the same way and keeps the completed advertiser pass", async () => {
    const store = new FakeCatalogSyncStore();
    const connector = withOverrides(new RecordedNetworkSimulator("clean-catalog"), {
      discoverPrograms: async () => ({
        ok: false,
        failure: leakingFailure("temporarily_unavailable", { retryAfterSeconds: null }),
      }),
    });
    const result = await run(connector, store);

    expect(result).toEqual({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: null } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(store.advertisers.size).toBeGreaterThan(0);
  });

  test("TP-W4-007 a synchronous throw is handled the same way and writes nothing", async () => {
    const store = new FakeCatalogSyncStore();
    const connector = withOverrides(new RecordedNetworkSimulator("clean-catalog"), {
      validateConnection: () => {
        throw new Error(`sync throw ${SECRET}`);
      },
    });
    const result = await run(connector, store);

    expect(result).toEqual({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: null } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(store.advertisers.size + store.programs.size + store.quarantined.length).toBe(0);
  });

  test("TP-W4-007 a connector that throws is reported as a retryable failure and its message is discarded", async () => {
    const cases: Overrides[] = [
      { validateConnection: async () => Promise.reject(new Error(`auth failed for ${SECRET}`)) },
      { discoverAdvertisers: async () => Promise.reject(new Error(`page fetch failed ${SECRET}`)) },
      { discoverPrograms: async () => Promise.reject(new Error(`program fetch failed ${SECRET}`)) },
    ];
    for (const overrides of cases) {
      const result = await run(withOverrides(new RecordedNetworkSimulator("clean-catalog"), overrides));

      expect(result).toEqual({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: null } });
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
  });
});
