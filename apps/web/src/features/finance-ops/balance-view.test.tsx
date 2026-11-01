import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type BalanceData, type BalanceState, BalanceView } from "./balance-view";

const ASOF = "2026-11-01T12:04:00.000Z";

const data = (overrides: Partial<BalanceData> = {}): BalanceData => ({
  asOf: ASOF,
  stale: false,
  currencies: [
    {
      currency: "USD",
      exponent: 2,
      estimated: 41200n,
      approved: 18820n,
      available: 7500n,
      reserved: 0n,
    },
  ],
  ...overrides,
});

const render = (state: BalanceState) => renderToStaticMarkup(<BalanceView state={state} />);

// SKELETONS §6.1 and §10.2. TP-W6-028 (buckets labelled), TP-W6-035 (stale shows data_stale, not 0.00), UI-046.
describe("BalanceView (UI-046, TP-W6-028, TP-W6-035)", () => {
  test("loading shows a status while balances are read", () => {
    expect(render({ kind: "loading" })).toContain("Loading balances…");
  });

  test("forbidden asks the owner", () => {
    expect(render({ kind: "forbidden" })).toContain("Ask an organization owner.");
  });

  test("an error shows the reference and no amounts", () => {
    const html = render({ kind: "error", ref: "req_7" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Ref: req_7");
    expect(html).not.toContain("USD");
  });

  test("unavailable says the figures are not connected yet, and shows no amounts", () => {
    const html = render({ kind: "unavailable" });
    expect(html).toContain("not available yet");
    expect(html).not.toContain("USD");
  });

  test("an empty ledger says there are no balances", () => {
    expect(render({ kind: "ready", data: data({ currencies: [] }) })).toContain("No balances yet.");
  });

  test("ready labels each bucket and shows each amount with its currency and as-of time", () => {
    const html = render({ kind: "ready", data: data() });
    expect(html).toContain("Estimated (not approved)");
    expect(html).toContain("Approved (pending clear)");
    expect(html).toContain("Reserved for payout");
    expect(html).toContain("USD 412.00");
    expect(html).toContain("USD 188.20");
    expect(html).toContain("USD 75.00");
    expect(html).toContain("as of");
    expect(html).toContain("Why is my balance not available?");
  });

  test("stale data keeps the numbers that are known and shows a dash for the bucket it cannot vouch for", () => {
    const html = render({
      kind: "ready",
      data: data({
        stale: true,
        currencies: [
          { currency: "USD", exponent: 2, estimated: 41200n, approved: null, available: 7500n, reserved: 0n },
        ],
      }),
    });
    expect(html).toContain("Data stale");
    expect(html).toContain("data stale");
    expect(html).toContain("USD 412.00");
    expect(html).toContain("—<span");
  });
});
