import type { CurrencyCode } from "../money/iso4217";
import { MoneyError } from "../money/money";
import type { Posting } from "./posting";

export type JournalResult = { ok: true; value: Journal } | { ok: false; error: MoneyError };

// A journal needs at least two postings, and each currency must balance on its own (§5.1 invariants 1 and 2).
export class Journal {
  private constructor(readonly postings: readonly Posting[]) {}

  static create(postings: readonly Posting[]): JournalResult {
    if (postings.length < 2) {
      return { ok: false, error: new MoneyError("journal needs at least 2 postings") };
    }
    const journal = new Journal(postings);
    for (const currency of journal.currencies()) {
      const net = journal.netByCurrency(currency);
      if (net !== 0n) {
        return { ok: false, error: new MoneyError(`${currency} postings do not sum to zero`) };
      }
    }
    return { ok: true, value: journal };
  }

  // Debits count positive, credits negative. Zero means the currency balances.
  netByCurrency(currency: CurrencyCode): bigint {
    let net = 0n;
    for (const p of this.postings) {
      if (p.money.currency !== currency) continue;
      net += p.side === "debit" ? p.money.amount : -p.money.amount;
    }
    return net;
  }

  private currencies(): Set<CurrencyCode> {
    return new Set(this.postings.map((p) => p.money.currency));
  }
}
