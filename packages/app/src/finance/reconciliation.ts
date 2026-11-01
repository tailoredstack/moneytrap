import type { Ctx } from "../ctx";
import type {
  LedgerReconciliationSource,
  ReconciliationJournal,
  ReconciliationPosting,
} from "../ports/ledger-reconciliation-source";

// What the nightly job can find wrong in the ledger. Each code names one broken invariant (§5.1).
export type ReconciliationFindingCode =
  | "journal_too_few_postings" // invariant 1: a journal has at least two postings
  | "journal_unbalanced" // invariant 2: debits equal credits in each currency
  | "posting_non_positive_amount" // DM-040: the side carries the direction, so the amount is positive
  | "posting_account_missing" // DM-040: a posting points at an account that exists
  | "posting_currency_mismatch" // DM-038: an account holds one currency, and postings use it
  | "reversal_original_missing" // invariant 4: a reversal links to a journal that exists
  | "reversal_of_reversal" // a reversal is never itself reversed
  | "reversal_duplicate" // at most one reversal per original
  | "reversal_not_mirror"; // invariant 4: a reversal undoes the original exactly

export interface ReconciliationFinding {
  code: ReconciliationFindingCode;
  journalId: string;
  postingId: string | null;
  currency: string | null;
  // The amount out of balance, in the currency's minor units, when the finding has one. Positive when debits are larger.
  deltaMinor: bigint | null;
  detail: string;
}

export interface CurrencyControlTotal {
  currency: string;
  debitMinor: bigint;
  creditMinor: bigint;
}

export interface CurrencyImbalance {
  currency: string;
  // The sum of the absolute imbalance of every unbalanced journal in the currency. Gross, so opposite imbalances in two
  // journals never cancel each other out.
  grossMinor: bigint;
}

export interface LedgerReconciliationReport {
  asOf: Date;
  // "clean" only when there is no finding at all. Every finding is unexplained: no register of known differences exists
  // yet, and a difference is never absorbed silently. Read status, not grossImbalance, as the pass or fail of a run.
  status: "clean" | "variance";
  counts: { accounts: number; journals: number; postings: number };
  // Debits and credits per currency over every posting, sorted by currency. Currencies are never summed together.
  controlTotals: CurrencyControlTotal[];
  // Only the amount that is out of balance, from unbalanced journals. A structural finding, such as a reversal for the
  // wrong amount, moves no money out of balance, so it shows in findingCounts and findings but not here.
  grossImbalance: CurrencyImbalance[];
  // How many findings there are of each code. Codes with none are absent.
  findingCounts: Partial<Record<ReconciliationFindingCode, number>>;
  findings: ReconciliationFinding[];
}

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function signed(posting: ReconciliationPosting): bigint {
  return posting.side === "debit" ? posting.amountMinor : -posting.amountMinor;
}

// The postings of a journal as a sorted list of keys. Two journals with the same keys move the same amounts between the
// same accounts on the same sides.
function movementKeys(postings: readonly ReconciliationPosting[], flip: boolean): string[] {
  return postings
    .map((p) => {
      const side = flip ? (p.side === "debit" ? "credit" : "debit") : p.side;
      return `${p.accountId}|${p.currency}|${side}|${p.amountMinor}`;
    })
    .sort(byText);
}

function sameMovement(original: ReconciliationJournal, reversal: ReconciliationJournal): boolean {
  const expected = movementKeys(original.postings, true);
  const actual = movementKeys(reversal.postings, false);
  return expected.length === actual.length && expected.every((key, index) => key === actual[index]);
}

// Reads the whole ledger from one snapshot and reports every place it disagrees with its own invariants. Read-only: it
// writes no journal, no audit row, and no outbox row, so running it twice on the same ledger gives the same findings.
// It needs only the clock, so the context type says so and a caller need not supply a database.
// The ledger cannot be corrected from here. A finding is for a person to investigate and fix with a reversal or an
// adjustment journal.
export async function reconcileLedger(
  ctx: Pick<Ctx, "clock">,
  source: LedgerReconciliationSource,
): Promise<LedgerReconciliationReport> {
  const asOf = ctx.clock.now();
  const snapshot = await source.snapshot();

  const accountCurrency = new Map(snapshot.accounts.map((account) => [account.id, account.currency]));
  const journals = [...snapshot.journals].sort((a, b) => byText(a.id, b.id));
  const journalById = new Map(journals.map((journal) => [journal.id, journal]));
  const findings: ReconciliationFinding[] = [];
  const totals = new Map<string, CurrencyControlTotal>();
  const variance = new Map<string, bigint>();
  let postingCount = 0;

  for (const journal of journals) {
    if (journal.postings.length < 2) {
      findings.push({
        code: "journal_too_few_postings",
        journalId: journal.id,
        postingId: null,
        currency: null,
        deltaMinor: null,
        detail: `journal has ${journal.postings.length} posting(s), needs at least 2`,
      });
    }

    const nets = new Map<string, bigint>();
    for (const posting of [...journal.postings].sort((a, b) => byText(a.id, b.id))) {
      postingCount += 1;
      nets.set(posting.currency, (nets.get(posting.currency) ?? 0n) + signed(posting));
      const total = totals.get(posting.currency) ?? { currency: posting.currency, debitMinor: 0n, creditMinor: 0n };
      if (posting.side === "debit") total.debitMinor += posting.amountMinor;
      else total.creditMinor += posting.amountMinor;
      totals.set(posting.currency, total);

      if (posting.amountMinor <= 0n) {
        findings.push({
          code: "posting_non_positive_amount",
          journalId: journal.id,
          postingId: posting.id,
          currency: posting.currency,
          deltaMinor: null,
          detail: `posting amount is ${posting.amountMinor}, must be positive`,
        });
      }
      const currency = accountCurrency.get(posting.accountId);
      if (currency === undefined) {
        findings.push({
          code: "posting_account_missing",
          journalId: journal.id,
          postingId: posting.id,
          currency: posting.currency,
          deltaMinor: null,
          detail: `account ${posting.accountId} does not exist`,
        });
      } else if (currency !== posting.currency) {
        findings.push({
          code: "posting_currency_mismatch",
          journalId: journal.id,
          postingId: posting.id,
          currency: posting.currency,
          deltaMinor: null,
          detail: `posting is in ${posting.currency}, account ${posting.accountId} holds ${currency}`,
        });
      }
    }

    for (const [currency, net] of [...nets].sort(([a], [b]) => byText(a, b))) {
      if (net === 0n) continue;
      findings.push({
        code: "journal_unbalanced",
        journalId: journal.id,
        postingId: null,
        currency,
        deltaMinor: net,
        detail: `${currency} postings do not sum to zero`,
      });
      variance.set(currency, (variance.get(currency) ?? 0n) + (net < 0n ? -net : net));
    }
  }

  const reversalsByOriginal = new Map<string, number>();
  for (const journal of journals) {
    if (journal.reversalOf === null) continue;
    const original = journalById.get(journal.reversalOf);
    const problem = (code: ReconciliationFindingCode, detail: string) =>
      findings.push({ code, journalId: journal.id, postingId: null, currency: null, deltaMinor: null, detail });

    if (original === undefined) {
      problem("reversal_original_missing", `journal ${journal.reversalOf} does not exist`);
      continue;
    }
    if (original.reversalOf !== null) {
      problem("reversal_of_reversal", `journal ${original.id} is itself a reversal`);
    }
    const seen = (reversalsByOriginal.get(original.id) ?? 0) + 1;
    reversalsByOriginal.set(original.id, seen);
    if (seen > 1) {
      problem("reversal_duplicate", `journal ${original.id} already has a reversal`);
    }
    if (!sameMovement(original, journal)) {
      problem("reversal_not_mirror", `postings do not undo journal ${original.id} exactly`);
    }
  }

  const findingCounts: Partial<Record<ReconciliationFindingCode, number>> = {};
  for (const finding of findings) findingCounts[finding.code] = (findingCounts[finding.code] ?? 0) + 1;

  return {
    asOf,
    status: findings.length === 0 ? "clean" : "variance",
    counts: { accounts: snapshot.accounts.length, journals: journals.length, postings: postingCount },
    controlTotals: [...totals.values()].sort((a, b) => byText(a.currency, b.currency)),
    grossImbalance: [...variance]
      .map(([currency, grossMinor]) => ({ currency, grossMinor }))
      .sort((a, b) => byText(a.currency, b.currency)),
    findingCounts,
    findings,
  };
}
