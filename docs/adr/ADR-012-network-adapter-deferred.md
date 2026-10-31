# ADR-012: No real network adapter until a partner is contracted; the simulator is the connector

- Status: Accepted, 2026-11-01 (decision to defer WP-4.3)
- Date: 2026-11-01
- Work package: WP-4.3 (real connector adapter), blocked on plan open question Q1

## Context

WP-4.3 builds `packages/adapter-network-<name>/` against a real affiliate network. The plan makes it depend on a partner decision (Plan Q1). No network is named in the project plan or the blueprint, and no sandbox or API credentials exist. The connector port (WP-4.1) and the recorded-fixture simulator (WP-4.2) are merged and pass the same contract surface. Building a real adapter now would mean guessing an API, its auth, and its data shape, then rewriting it when a partner is chosen.

Risk R1 in the project plan already anticipates this: build against the simulator and keep the port stable so the real adapter drops in later.

## Decision

- Do not build a real network adapter (WP-4.3) until a network partner is contracted and sandbox access exists.
- The recorded-fixture simulator (WP-4.2) is the connector for M3 development and conformance.
- Wave 4 proceeds without WP-4.3. WP-4.12 (activate network conformance) runs against the simulator, which WP-4.12 already lists as a dependency.
- The connector port and capability profile (WP-4.1) stay the stable seam, so a later adapter needs no change to app code.

## Evidence

- WP-4.1 and WP-4.2 are merged (PR #89, PR #90).
- Project plan R1 mitigation: "Build against a recorded fixture simulator; keep the connector port stable so the real adapter drops in later."

## Revisit trigger

Reopen this decision when a network partner is contracted and provides sandbox or API access. The new work starts WP-4.3 and must choose the network, record the chosen network in a follow-up ADR, and pass the same adapter contract suite as the simulator.

## Fallback

If the M3 pilot cannot run on the simulator alone, the team takes that as a new decision and picks a network before WP-4.3 starts. This ADR is superseded by that decision.
