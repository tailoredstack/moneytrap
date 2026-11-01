# ADR-013: Rakuten Advertising is the first affiliate network partner

- Status: Accepted, 2026-11-01 (supersedes ADR-012)
- Date: 2026-11-01
- Work package: WP-4.3 (real connector adapter), now unblocked for planning; the adapter itself is not built by this ADR

## Context

ADR-012 kept WP-4.3 deferred until a network partner was contracted and sandbox access existed. It also required a follow-up ADR to name the network. Plan Q1 is now decided: the project owner reports that the team has signed up with Rakuten Advertising as the first affiliate network partner.

Rakuten Advertising is the network the team will build the first connector against. Its public developer documentation covers the affiliate APIs, and its developer guide covers how to try them out. The team reports that sandbox and API access are available now. Building against a real sandbox lets WP-4.3 test real responses instead of guessing an API shape, which was the risk ADR-012 named.

## Decision

- Rakuten Advertising is the first network for `packages/adapter-network-rakuten/` (WP-4.3). The adapter must pass the same adapter contract suite as the recorded-fixture simulator (WP-4.2).
- ADR-012 is superseded. The simulator remains the connector for conformance tests and for any environment without Rakuten credentials.
- The `NetworkConnector` port in `packages/app/src/ports/network-connector.ts` (WP-4.1) stays the seam. No app code changes because of this decision.
- Credentials follow the blueprint's secret rule (environment or secret store, encrypted at rest). They are never written to the repo, a PR, or Linear.
- Not decided here:
  - The adapter design, its file layout, or its mapping of Rakuten responses onto the `NetworkConnector` operations. WP-4.3 owns those.
  - Whether Rakuten is contracted for production use, its commercial terms, or its fee schedule.
  - The wedge country and currency (plan open question 2). That question stays open. Rakuten's settlement currency is not confirmed here.
  - Any second network. Other networks are out of scope until a later ADR names them.
  - The exact endpoint paths and token lifetimes. The developer portal pages were not fully readable when this ADR was written, so WP-4.3 must confirm them against the live portal and its sandbox. Whether Rakuten's API covers the plan's criteria (transactions, adjustments, sandbox) is also unverified here.
  - Optimize consent, which the plan previously reserved for ADR-013. That work package needs a new number (see the note in `docs/adr/README.md`).

## Evidence

- Rakuten Advertising affiliate API documentation: https://developers.rakutenadvertising.com/documentation/en-US/affiliate_apis
- Rakuten Advertising developer guide: https://developers.rakutenadvertising.com/guides/try_out_apis
- Plan Q1 decision and signup: the team's decision, given to this ADR by the project owner. It is not backed by a document in this repo.
- Sandbox and API access: the team's report that both are available now. This ADR does not restate the sandbox URL, token type, or any credential value. Those belong in the secret store and the adapter's configuration.

## Revisit trigger

Reopen this decision if Rakuten sandbox or API access is revoked, if the contract does not cover the operations listed in WP-4.3, or if the M3 pilot needs a second network before the first adapter merges.

## Fallback

If the Rakuten sandbox cannot support the contract suite, WP-4.3 stays on the simulator and the team records a new network decision in a follow-up ADR. The simulator remains the conformance connector, as set out under Decision above.
