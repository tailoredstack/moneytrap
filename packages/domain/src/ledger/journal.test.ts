import { describe, expect, test } from "bun:test";
import type { CurrencyCode } from "../money/iso4217";
import { Money } from "../money/money";
import { Journal } from "./journal";
import { Posting } from "./posting";

const usd = (amount: bigint) => Money.of(amount, "USD");
const eur = (amount: bigint) => Money.of(amount, "EUR");

describe("Journal", () => {
  test("TP-W6-001 two postings that sum to zero are accepted", () => {
    const r = Journal.create([Posting.debit("cash", usd(1000n)), Posting.credit("revenue", usd(1000n))]);
    expect(r.ok).toBe(true);
  });

  test("TP-W6-002 postings summing to non-zero are rejected", () => {
    const r = Journal.create([Posting.debit("cash", usd(1000n)), Posting.credit("revenue", usd(999n))]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_FAILED");
  });

  test("a journal with fewer than 2 postings is rejected", () => {
    expect(Journal.create([]).ok).toBe(false);
    expect(Journal.create([Posting.debit("cash", usd(1n))]).ok).toBe(false);
  });

  test("TP-W6-003 mixed currencies must each balance without offset across currencies", () => {
    const r = Journal.create([Posting.debit("cash-usd", usd(1000n)), Posting.credit("cash-eur", eur(1000n))]);
    expect(r.ok).toBe(false);
  });

  test("mixed currencies are accepted when each currency balances on its own", () => {
    const r = Journal.create([
      Posting.debit("cash-usd", usd(1000n)),
      Posting.credit("revenue-usd", usd(1000n)),
      Posting.debit("cash-eur", eur(500n)),
      Posting.credit("revenue-eur", eur(500n)),
    ]);
    expect(r.ok).toBe(true);
  });

  test("DM-040 posting amounts must be strictly positive", () => {
    expect(() => Posting.debit("cash", usd(0n))).toThrow(/VALIDATION_FAILED/);
    expect(() => Posting.credit("cash", usd(-5n))).toThrow(/VALIDATION_FAILED/);
  });

  test("TP-W6-004 property: random sequences balance per currency iff accepted", () => {
    const currencies: CurrencyCode[] = ["USD", "EUR", "JPY"];
    let seed = 0x5eed;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };

    for (let trial = 0; trial < 500; trial++) {
      const length = next(8);
      const postings: Posting[] = [];
      for (let i = 0; i < length; i++) {
        const currency = currencies[next(currencies.length)] as CurrencyCode;
        const amount = BigInt(next(1000) + 1);
        const money = Money.of(amount, currency);
        postings.push(
          next(2) === 0 ? Posting.debit(`acct-${next(4)}`, money) : Posting.credit(`acct-${next(4)}`, money),
        );
      }

      const net = new Map<CurrencyCode, bigint>();
      for (const p of postings) {
        const signed = p.side === "debit" ? p.money.amount : -p.money.amount;
        net.set(p.money.currency, (net.get(p.money.currency) ?? 0n) + signed);
      }
      const balanced = [...net.values()].every((v) => v === 0n);
      const expected = length >= 2 && balanced;

      const r = Journal.create(postings);
      expect(r.ok).toBe(expected);
      if (r.ok) {
        for (const currency of currencies) {
          expect(r.value.netByCurrency(currency)).toBe(0n);
        }
      }
    }
  });

  test("TP-W6-004 property: balanced constructions are always accepted", () => {
    const currencies: CurrencyCode[] = ["USD", "EUR"];
    let seed = 0xba1a;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };

    for (let trial = 0; trial < 300; trial++) {
      const postings: Posting[] = [];
      const pairs = 1 + next(5);
      for (let i = 0; i < pairs; i++) {
        const currency = currencies[next(currencies.length)] as CurrencyCode;
        const money = Money.of(BigInt(next(10_000) + 1), currency);
        postings.push(Posting.debit(`acct-${next(4)}`, money));
        postings.push(Posting.credit(`acct-${next(4)}`, money));
      }
      expect(Journal.create(postings).ok).toBe(true);
    }
  });
});
