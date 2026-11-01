import { describe, expect, test } from "bun:test";
import { type PullDeps, pullTransactions } from "@moneytrap/app/src/conversions/pull";
import type { NetworkConnector, TransactionRecord } from "@moneytrap/app/src/ports/network-connector";
import { FakeTransactionPullStore } from "../fakes/transaction-pull-store";
import { RECORDED_FIXTURES, type RecordedFixture } from "./fixtures";
import { RecordedNetworkSimulator } from "./simulator";

const NETWORK = "net_sim";
const OCTOBER = { from: new Date("2026-10-01T00:00:00.000Z"), to: new Date("2026-11-01T00:00:00.000Z") };
const WATERMARK = new Date("2026-10-01T00:00:00.000Z");

function harness(connector: Pick<NetworkConnector, "listTransactions">) {
  const store = new FakeTransactionPullStore();
  const deps: PullDeps = { connector, store };
  const received: TransactionRecord[] = [];
  const run = (range = OCTOBER) =>
    pullTransactions(deps, { networkId: NETWORK, ...range }, async (items) => {
      received.push(...items);
    });
  return { store, received, run };
}

describe("pullTransactions", () => {
  // TP-W6-025
  test("walks every page of the range and stores the watermark", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");
    const { store, received, run } = harness(simulator);

    const result = await run();

    expect(result).toEqual({ ok: true, value: { pages: 2, watermark: WATERMARK } });
    expect(received.map((item) => item.sourceId)).toEqual(["txn-1", "txn-2", "txn-3"]);
    expect(simulator.requests.filter((request) => request.operation === "list_transactions")).toHaveLength(2);
    expect(await store.loadCursor(NETWORK, scopeOf(OCTOBER))).toEqual({ cursor: null, watermark: WATERMARK });
  });

  test("keeps amounts as bigint minor units", async () => {
    const { received, run } = harness(new RecordedNetworkSimulator("clean-catalog"));

    await run();

    expect(received[0]?.amount.amount).toBe(12_500n);
    expect(received[0]?.amount.currency).toBe("USD");
  });

  test("TP-W4-041 an unsupported Events page fails without advancing its saved cursor or watermark", async () => {
    const store = new FakeTransactionPullStore();
    const scope = scopeOf(OCTOBER);
    await store.saveCursor(NETWORK, scope, { cursor: "resume-here", watermark: WATERMARK });
    const connector: Pick<NetworkConnector, "listTransactions"> = {
      async listTransactions() {
        return { ok: false, failure: { state: "unsupported" } };
      },
    };
    const result = await pullTransactions({ connector, store }, { networkId: NETWORK, ...OCTOBER }, async () => {
      throw new Error("a failed Events page must not import rows");
    });

    expect(result).toEqual({ ok: false, failure: { state: "unsupported" } });
    expect(await store.loadCursor(NETWORK, scope)).toEqual({ cursor: "resume-here", watermark: WATERMARK });
  });

  test("returns only transactions inside the requested range", async () => {
    const { received, run } = harness(new RecordedNetworkSimulator("clean-catalog"));

    await run({ from: new Date("2026-10-04T00:00:00.000Z"), to: new Date("2026-10-06T00:00:00.000Z") });

    expect(received.map((item) => item.sourceId)).toEqual(["txn-2"]);
  });

  // TP-W6-019 applied to the pull: a page that fails mid-pass is not skipped, and a resumed pull adds no duplicates.
  test("resumes from the saved cursor after a failed page with no duplicates", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");
    let calls = 0;
    const flaky: Pick<NetworkConnector, "listTransactions"> = {
      listTransactions: (input) => {
        calls += 1;
        if (calls === 2) {
          return Promise.resolve({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: 30 } });
        }
        return simulator.listTransactions(input);
      },
    };
    const { store, received, run } = harness(flaky);

    const interrupted = await run();
    expect(interrupted).toEqual({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: 30 } });
    expect(received.map((item) => item.sourceId)).toEqual(["txn-1", "txn-2"]);
    expect(await store.loadCursor(NETWORK, scopeOf(OCTOBER))).toMatchObject({ watermark: null });

    const resumed = await run();
    expect(resumed).toEqual({ ok: true, value: { pages: 1, watermark: WATERMARK } });
    expect(received.map((item) => item.sourceId)).toEqual(["txn-1", "txn-2", "txn-3"]);
    expect(await store.loadCursor(NETWORK, scopeOf(OCTOBER))).toEqual({ cursor: null, watermark: WATERMARK });
  });

  test("keeps the last completed watermark while a later pass is in progress", async () => {
    const simulator = new RecordedNetworkSimulator("clean-catalog");
    const { store, run } = harness(simulator);
    await run();
    const completed = await store.loadCursor(NETWORK, scopeOf(OCTOBER));

    // A new pass on the same range starts from the beginning, so the stored watermark must survive its first page.
    let calls = 0;
    const flaky: Pick<NetworkConnector, "listTransactions"> = {
      listTransactions: (input) => {
        calls += 1;
        if (calls === 2) {
          return Promise.resolve({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: null } });
        }
        return simulator.listTransactions(input);
      },
    };
    const second = harness(flaky);
    await second.store.saveCursor(NETWORK, scopeOf(OCTOBER), completed);
    await second.run();

    expect(await second.store.loadCursor(NETWORK, scopeOf(OCTOBER))).toMatchObject({ watermark: WATERMARK });
  });

  test("a disabled credential returns not_authorized and stores nothing", async () => {
    const disabled: RecordedFixture = { ...RECORDED_FIXTURES["clean-catalog"], credentialEnabled: false };
    const { store, received, run } = harness(new RecordedNetworkSimulator(disabled));

    const result = await run();

    expect(result).toEqual({ ok: false, failure: { state: "not_authorized" } });
    expect(received).toEqual([]);
    expect(await store.loadCursor(NETWORK, scopeOf(OCTOBER))).toEqual({ cursor: null, watermark: null });
  });

  test("a connector that throws is reported as a retryable failure and stores nothing", async () => {
    const broken: Pick<NetworkConnector, "listTransactions"> = {
      listTransactions: () => Promise.reject(new Error("socket reset with token sk_live_secret")),
    };
    const { store, run } = harness(broken);

    const result = await run();

    expect(result).toEqual({ ok: false, failure: { state: "temporarily_unavailable", retryAfterSeconds: null } });
    expect(await store.loadCursor(NETWORK, scopeOf(OCTOBER))).toEqual({ cursor: null, watermark: null });
  });
});

function scopeOf(range: { from: Date; to: Date }): string {
  return `transactions:${range.from.getTime()}..${range.to.getTime()}`;
}
