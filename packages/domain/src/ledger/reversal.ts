import { MoneyError } from "../money/money";
import { Journal, type JournalResult } from "./journal";
import { Posting } from "./posting";

// A journal as recorded in the ledger. Reversals point back at the journal they undo.
export type RecordedJournal = {
  id: string;
  journal: Journal;
  reversalOf: string | null;
};

export type ReversalResult = { ok: true; value: RecordedJournal } | { ok: false; error: MoneyError };

// A reversal is a new journal with every side flipped, linked to the original (§5.1 invariant 4).
// The original is only read, never changed. Postings are immutable, so the new journal shares no state with it.
// A reversal of a reversal is rejected, which keeps reversal chains from looping (TP-W6-009).
// This function cannot see the ledger, so the caller passes `alreadyReversed` from the store.
// Reversing the same original twice would undo its movement twice, so that case is rejected too.
export function reverse(original: RecordedJournal, reversalId: string, alreadyReversed: boolean): ReversalResult {
  if (original.reversalOf !== null) {
    return { ok: false, error: new MoneyError("a reversal cannot be reversed") };
  }
  if (alreadyReversed) {
    return { ok: false, error: new MoneyError("journal has already been reversed") };
  }
  const flipped = original.journal.postings.map((p) =>
    p.side === "debit" ? Posting.credit(p.accountId, p.money) : Posting.debit(p.accountId, p.money),
  );
  const result: JournalResult = Journal.create(flipped);
  if (!result.ok) return result;
  return { ok: true, value: { id: reversalId, journal: result.value, reversalOf: original.id } };
}
