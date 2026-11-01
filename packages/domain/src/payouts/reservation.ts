// How much of a publisher's available balance a batch may reserve (DM-048, spec §4.5, CT-022). Pure: no clock, no I/O.
// Available is the cleared amount (WP-6.9). Committed is what earlier, still-open payouts already hold against it, so a
// second batch over the same funds reserves only what is left and the sum of reservations never exceeds available.
// Amounts are bigint minor units.

export type ReservationSkip = "nothing_available" | "below_minimum" | "over_cap";

export type ReservationDecision =
  | { reservedMinor: bigint; skipped: null }
  | { reservedMinor: 0n; skipped: ReservationSkip };

export function decideReservation(input: {
  // What the payout policy says may be paid now (zero or negative means nothing was requested).
  requestedMinor: bigint;
  availableMinor: bigint;
  // The sum of payouts that still hold funds against this publisher and currency.
  committedMinor: bigint;
  // The policy minimum the reserved amount must still reach after the cuts below.
  minimumMinor: bigint;
  // What is left of the batch's release cap, or null when the batch has none.
  capRemainingMinor: bigint | null;
}): ReservationDecision {
  const { requestedMinor, availableMinor, committedMinor, minimumMinor, capRemainingMinor } = input;
  for (const [name, value] of Object.entries({ availableMinor, committedMinor, minimumMinor })) {
    if (typeof value !== "bigint" || value < 0n)
      throw new RangeError(`reservation: ${name} must be a non-negative bigint`);
  }

  const headroom = availableMinor - committedMinor;
  if (requestedMinor <= 0n || headroom <= 0n) return { reservedMinor: 0n, skipped: "nothing_available" };

  let amount = headroom;
  if (requestedMinor < amount) amount = requestedMinor;
  let capped = false;
  if (capRemainingMinor !== null) {
    if (capRemainingMinor <= 0n) return { reservedMinor: 0n, skipped: "over_cap" };
    if (capRemainingMinor < amount) {
      amount = capRemainingMinor;
      capped = true;
    }
  }
  // A cut that leaves less than the minimum reserves nothing, so a batch never holds a payout the policy would refuse.
  if (amount < minimumMinor) return { reservedMinor: 0n, skipped: capped ? "over_cap" : "below_minimum" };
  return { reservedMinor: amount, skipped: null };
}
