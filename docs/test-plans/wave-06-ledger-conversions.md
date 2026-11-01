# Test Plan — Wave 6: Conversions and ledger

**Scope:** WP-6.1 to WP-6.13 · **Milestone:** M5 · **Plan index:** [README](README.md)
**Test IDs:** `TP-W6-###`
**Conformance focus:** CT-012, CT-016, CT-017, CT-018, CT-020

## 1. Objective

Imported conversions become correct, auditable publisher earnings. The ledger balances for every sequence of postings. Replays do not double count. Estimated, approved, and available amounts are never confused.

## 2. Entry criteria

- Wave 4 gate passed (connector simulator and catalog).
- Ledger domain (WP-6.1, 6.2, 6.4) may already be merged as an early start; its tests must be green before this wave's gate.
- Finance review of share-rule examples scheduled.

## 3. Test matrix

### 3.1 Ledger domain (pure, property-based)

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W6-001 | Journal with two postings that sum to zero | Accepted | WP-6.1 |
| TP-W6-002 | Journal with postings summing to non-zero | Rejected | WP-6.1 |
| TP-W6-003 | Journal mixing USD and EUR without an FX transaction | Rejected | WP-6.1, §5.1 |
| TP-W6-004 | Property: random sequences of postings | Every committed journal sums to zero per currency | WP-6.1 |
| TP-W6-005 | Share rule 70/30 on 0.01 USD | Largest-remainder allocation; sums exactly to 0.01 | WP-6.2 |
| TP-W6-006 | Property: random amounts and share rules | `publisher + platform + other = recognized` exactly | WP-6.2, §5.1 |
| TP-W6-007 | Rounding rule version changed | Old allocations unchanged; new version applies to new journals only | WP-6.2 |
| TP-W6-008 | Reversal of a journal | New journal linked to original; original unchanged; net zero | WP-6.4 |
| TP-W6-009 | Reversal of a reversal | Rejected or documented equivalent; no loop | WP-6.4 |

### 3.2 Ledger persistence

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W6-010 | Commit unbalanced journal directly in SQL | Deferred constraint rejects at commit | WP-6.3 |
| TP-W6-011 | Posting currency differs from account currency | Check constraint rejects | WP-6.3 |
| TP-W6-012 | Property test against Postgres: 1,000 random journals | Balances hold; no partial commit | WP-6.3 |
| TP-W6-013 | Concurrent journals to same account | Final balance equals sum; no lost update | WP-6.3 |

### 3.3 Import, replay, and revisions

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W6-014 | Import batch once | Rows created with source IDs and revision 1 | WP-6.5 |
| TP-W6-015 | Replay identical batch | No-op; no new rows; no new journals | WP-6.5, CT-012 |
| TP-W6-016 | Replay batch with one changed amount | New revision for that row only; prior revision kept | WP-6.5, CT-018 |
| TP-W6-017 | Downward revision after payout | Adjustment journal; history intact; no duplicate entries | WP-6.6, CT-018 |
| TP-W6-018 | Status events | Transitions recorded; illegal transition rejected | WP-6.6 |
| TP-W6-019 | Interrupted import, resumed | Completes with no duplicates | WP-6.5 |
| TP-W6-020 | Malformed row in batch | Row quarantined; others imported | WP-6.5 |

### 3.4 Attribution

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W6-021 | Conversion matches click inside window | Attributed to link and publisher | WP-6.7 |
| TP-W6-022 | Conversion with no click | Exception queue; not assigned to any publisher | WP-6.7, CT-020 |
| TP-W6-023 | Conversion outside window | Exception with reason `window` | WP-6.7 |
| TP-W6-024 | Two possible clicks | Deterministic rule applied and recorded | WP-6.7 |
| TP-W6-025 | Pull transactions from simulator, cursor | All pages; watermark stored | WP-6.8 |

### 3.5 Balances, statements, reports

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W6-026 | Approved, not yet remitted conversion | Shown as approved; not available | WP-6.9, CT-017 |
| TP-W6-027 | Payout-eligible funds only after clearance | Available increases only on clearance | WP-6.9 |
| TP-W6-028 | Balance view shows estimated, approved, available separately | Each value labeled; sums consistent | WP-6.9 |
| TP-W6-029 | Conversion share applied to publisher, platform, advertiser splits | Traceable from conversion to publisher line | WP-6.9, §5.1 |
| TP-W6-030 | Close statement period, regenerate | Hash identical; content unchanged | WP-6.10 |
| TP-W6-031 | Earnings report with stale source | `data_stale` returned; amount not shown as zero | WP-6.11 |
| TP-W6-032 | Earnings report amounts | Include currency and `as_of` | WP-6.11 |

### 3.6 Finance ops UI

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W6-033 | Exceptions queue with 300 items | Paginated; filter by reason; keyboard reachable | WP-6.12 |
| TP-W6-034 | Statement detail | Shows period, currency, `as_of`, hash | WP-6.12 |
| TP-W6-035 | Balance card when source stale | Shows `data_stale`, not `0.00` | WP-6.12 |
| TP-W6-036 | Import list with failed batch | Failure reason visible; retry path | WP-6.12 |

### 3.7 Conformance

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W6-037 | CT-012, CT-016 to CT-018, CT-020 | Green | WP-6.13 |

### 3.8 Ledger reconciliation job

The job reads the ledger tables and checks them against the ledger's own invariants. It does not yet compare the ledger with the network report or the settlement receipts, because no stored link ties a journal to a conversion or a receipt; that comparison is tracked separately.

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W6-038 | Sandbox ledger: sales in three currencies, a reversal, an amount past 2^53 | Report is `clean`; control totals balance per currency; no finding | WP-X.3 |
| TP-W6-039 | Journal written while the balance trigger was off: debits exceed credits | `journal_unbalanced` with the delta in minor units; `grossImbalance` per currency; exit code 1 | WP-X.3 |
| TP-W6-040 | Reversal for a different amount, on other accounts, or with the original sides; reversal of a reversal; missing original | One finding per case; none is absorbed. Status is `variance` and `findingCounts` names the code, even though `grossImbalance` is empty because no amount is out of balance | WP-X.3, §5.1 invariant 4 |
| TP-W6-041 | Journal with one posting; posting with zero amount; posting in a currency its account does not hold | A finding each | WP-X.3, DM-038 to DM-040 |
| TP-W6-042 | Run the job twice, and run it with journals returned in another order | Same report; no row written in any table; one read-only transaction | WP-X.3 |
| TP-W6-043 | Run the entry point as a process | Exit 0 clean, 1 on variance, 2 without `DATABASE_URL`; JSON report on stdout with string amounts | WP-X.3 |

### 3.9 Postgres follow-up coverage

These rows add persistence and real-store coverage for Wave 6 follow-ups. Wave 7 payable/paid behavior and Wave 8 API-047 are outside this section.

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W6-044 | Persist a conversion matched to a click, resolving publisher through the linked link; persist `last_click_in_window` | Postgres reload preserves the match, publisher attribution, and qualifying-window timestamp | OZE-3262, WP-6.7 |
| TP-W6-045 | Import unmatched conversions and repeated exceptions for one conversion | Every unmatched import creates an exception; exception uniqueness is per conversion; no publisher is assigned without a qualifying click | OZE-3262, WP-6.7, CT-020 |
| TP-W6-046 | Pull a multi-page Postgres transaction feed, stop, restart, and resume | Resume uses the persisted cursor and completes without omissions or duplicates; fake and Postgres cursor contract tests pass | OZE-3261, WP-6.8 |
| TP-W6-047 | Read PublisherBalanceSource from Postgres with attributed conversions, latest status, adjustments, and clearance | Matches app-source behavior; adjustments are netted into `recognizedMinor`; clearance changes availability consistently | OZE-3263, WP-6.9, CT-016, CT-017; needs-finance-review |
| TP-W6-048 | Persist and reload a statement; regenerate a closed period through the real Postgres store | Statement content/hash remains immutable for the closed period; regeneration does not alter stored content | OZE-3264, WP-6.10, API-052, API-053 |
| TP-W6-049 | Serve statement routes through the application with persisted Postgres statement data | API-052 and API-053 routes return the stored statement contract; route tests exercise the served handlers | OZE-3264, WP-6.10, API-052, API-053 |
| TP-W6-050 | Approve a conversion through its use case against the real ledger, then replay approval | Exactly one ledger posting is created for the approved conversion | OZE-3265, WP-6.9, CT-016 |
| TP-W6-051 | Reverse an approved conversion through its use case against the real ledger | A linked reversal is created exactly once; original conversion and journal remain unchanged | OZE-3265, WP-6.4, WP-6.9, CT-016 |
| TP-W6-052 | Read Wave 6 earnings through the Postgres EarningsSource adapter with fresh and stale source states | Fake/Postgres parity; stale source returns `data_stale`, never zero; response carries currency and `as_of` | OZE-3266, WP-6.11 |

## 4. Exit criteria

- All TP-W6 green; property suites run ≥ 10,000 cases in nightly and ≥ 1,000 per PR.
- Finance reviewers sign the ledger invariants document (Project plan M5 gate).
- One sandbox month reconciles to the network report with zero unexplained variance (WP-X.3).

## 5. Test data

- Share rules: 50/50, 70/30, 33/33/34 three-way, with rounding edge cases.
- Amounts: 0.01, 0.99, 1,000,000.00, currencies with exponent 0 and 3 where supported.
- Batches: clean, replayed, revised, malformed, interrupted.

## 6. Risks

- Rounding rule disagreement with finance. Lock the rule as ADR-005 before WP-6.2 merges.
- Reconciliation variance caused by network-side rounding. Record as known difference with source reference, never absorb silently.
