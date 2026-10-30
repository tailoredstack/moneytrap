# ADR-005: Money as bigint minor units, with largest-remainder allocation

- Status: Accepted, 2026-10-31 (gate: WP-1.1 domain tests green)
- Date: 2026-10-31
- Spike: none. Decided from Blueprint §5.1 and the specification's invariants (§5.1, §7.2).

## Context

Revenue and payouts must sum exactly. Floating-point amounts lose cents, and a share split can lose or create a unit of currency unless the rounding rule is explicit.

## Decision

- The domain represents an amount as `Money = { minor: bigint; currency }`. The currency exponent comes from a static ISO 4217 table in `domain`.
- Postgres stores minor units in `bigint` columns, with a currency column and a check constraint that each posting's currency matches its account.
- JSON encodes amounts as the decimal string required by specification §7.2, produced by one formatter. Parsing is strict. `parseFloat` is not used on money.
- Share splits use largest-remainder allocation under a versioned rounding rule, so `publisher + platform + other = recognized` holds exactly (specification §5.1, invariant 3). Each allocation records the rule version it used.
- Every journal has at least two postings that sum to zero per currency. A deferred constraint trigger and a domain check before insert enforce this.

## Evidence

No spike covers money. WP-1.1 starts with failing domain tests: `Money` rejects a non-integer minor amount and a currency mismatch, which is the first red test in Blueprint §13.

## Consequences

- JSON and API contracts carry amounts as strings. A `bigint` cannot pass through `JSON.stringify`, so the single formatter is required.
- A currency with an unusual exponent is a new row in the ISO table, not a change of representation.

## Fallback

If a finance rule cannot be expressed with largest-remainder allocation, add a new rounding-rule version. Do not change the representation to floats or decimal numbers in the domain without a new ADR.
