import { describe, expect, test } from "bun:test";
import { Money } from "../money/money";
import { Journal } from "./journal";
import { Posting } from "./posting";
import { type RecordedJournal, reverse } from "./reversal";

const usd = (amount: bigint) => Money.of(amount, "USD");
const eur = (amount: bigint) => Money.of(amount, "EUR");

const record = (id: string, postings: Posting[]): RecordedJournal => {
  const r = Journal.create(postings);
  if (!r.ok) throw r.error;
  return { id, journal: r.value, reversalOf: null };
};

const snapshot = (entry: RecordedJournal) =>
  entry.journal.postings.map((p) => ({
    accountId: p.accountId,
    side: p.side,
    amount: p.money.amount,
    currency: p.money.currency,
  }));

describe("reverse", () => {
  test("TP-W6-008 reversal links to the original and nets the original to zero", () => {
    const original = record("j-1", [
      Posting.debit("cash-usd", usd(2000n)),
      Posting.credit("revenue-usd", usd(1500n)),
      Posting.credit("share-publisher-usd", usd(500n)),
      Posting.debit("cash-eur", eur(300n)),
      Posting.credit("revenue-eur", eur(300n)),
    ]);

    const r = reverse(original, "j-2");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.id).toBe("j-2");
    expect(r.value.reversalOf).toBe("j-1");
    for (const currency of ["USD", "EUR"] as const) {
      expect(r.value.journal.netByCurrency(currency)).toBe(0n);
      expect(original.journal.netByCurrency(currency)).toBe(0n);
    }
    expect(snapshot(r.value)).toEqual(
      snapshot(original).map((p) => ({ ...p, side: p.side === "debit" ? "credit" : "debit" })),
    );
  });

  test("TP-W6-008 the original journal is never mutated by a reversal", () => {
    const original = record("j-1", [Posting.debit("cash", usd(1000n)), Posting.credit("revenue", usd(1000n))]);
    const before = snapshot(original);

    const r = reverse(original, "j-2");
    expect(r.ok).toBe(true);
    expect(snapshot(original)).toEqual(before);
    expect(original.reversalOf).toBeNull();
    expect(original.id).toBe("j-1");
  });

  test("TP-W6-009 reversing a reversal is rejected", () => {
    const original = record("j-1", [Posting.debit("cash", usd(1000n)), Posting.credit("revenue", usd(1000n))]);
    const first = reverse(original, "j-2");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = reverse(first.value, "j-3");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("VALIDATION_FAILED");
  });
});
