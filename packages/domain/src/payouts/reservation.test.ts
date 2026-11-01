import { describe, expect, test } from "bun:test";
import { decideReservation } from "./reservation";

const base = { requestedMinor: 10_000n, availableMinor: 10_000n, committedMinor: 0n, minimumMinor: 5_000n };

describe("decideReservation (CT-022, TP-W7-012)", () => {
  test("reserves the requested amount when the funds are free", () => {
    expect(decideReservation({ ...base, capRemainingMinor: null })).toEqual({ reservedMinor: 10_000n, skipped: null });
  });

  test("a second reservation over the same funds reserves only what is left", () => {
    expect(
      decideReservation({ ...base, committedMinor: 6_000n, minimumMinor: 1_000n, capRemainingMinor: null }),
    ).toEqual({
      reservedMinor: 4_000n,
      skipped: null,
    });
  });

  test("fully committed funds reserve nothing", () => {
    expect(decideReservation({ ...base, committedMinor: 10_000n, capRemainingMinor: null })).toEqual({
      reservedMinor: 0n,
      skipped: "nothing_available",
    });
  });

  test("committed above available (a reversal after reservation) reserves nothing, never a negative", () => {
    expect(
      decideReservation({ ...base, availableMinor: 3_000n, committedMinor: 10_000n, capRemainingMinor: null }),
    ).toEqual({ reservedMinor: 0n, skipped: "nothing_available" });
  });

  test("a remainder under the policy minimum is skipped", () => {
    expect(decideReservation({ ...base, committedMinor: 6_000n, capRemainingMinor: null })).toEqual({
      reservedMinor: 0n,
      skipped: "below_minimum",
    });
  });

  test("a zero request reserves nothing", () => {
    expect(decideReservation({ ...base, requestedMinor: 0n, capRemainingMinor: null }).skipped).toBe(
      "nothing_available",
    );
  });

  test("the cap cuts the reservation to what is left of it", () => {
    expect(decideReservation({ ...base, minimumMinor: 1_000n, capRemainingMinor: 7_000n })).toEqual({
      reservedMinor: 7_000n,
      skipped: null,
    });
  });

  test("an exhausted cap, or a cut below the minimum, is over_cap", () => {
    expect(decideReservation({ ...base, capRemainingMinor: 0n }).skipped).toBe("over_cap");
    expect(decideReservation({ ...base, capRemainingMinor: 4_999n }).skipped).toBe("over_cap");
  });

  test("a cap larger than the amount changes nothing", () => {
    expect(decideReservation({ ...base, capRemainingMinor: 50_000n }).reservedMinor).toBe(10_000n);
  });

  test("negative inputs are refused", () => {
    expect(() => decideReservation({ ...base, availableMinor: -1n, capRemainingMinor: null })).toThrow(RangeError);
    expect(() => decideReservation({ ...base, committedMinor: -1n, capRemainingMinor: null })).toThrow(RangeError);
  });

  // TP-W7-015 core: whatever the interleaving of requests, reservations never exceed available.
  test("property: sequential reservations never exceed available", () => {
    let seed = 12345;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };
    for (let run = 0; run < 500; run += 1) {
      const available = BigInt(next(100_000));
      const minimum = BigInt(next(2_000));
      let committed = 0n;
      for (let step = 0; step < 8; step += 1) {
        const decision = decideReservation({
          requestedMinor: BigInt(next(60_000)),
          availableMinor: available,
          committedMinor: committed,
          minimumMinor: minimum,
          capRemainingMinor: next(2) === 0 ? null : BigInt(next(40_000)),
        });
        committed += decision.reservedMinor;
        expect(committed <= available).toBe(true);
      }
    }
  });
});
