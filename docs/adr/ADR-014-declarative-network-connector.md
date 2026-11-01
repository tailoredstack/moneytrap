# ADR-014: Network adapters stay code until a spike proves a declarative connector engine

- Status: Accepted, 2026-11-01 (gate: declarative-engine spike, OZE-3275)
- Date: 2026-11-01
- Work package: none yet. The spike and the dashboard work are tracked in Linear (OZE-3275, OZE-3274); the plan gets work package rows only if the spike passes.

## Context

ADR-013 chose Rakuten Advertising, and WP-4.3 built `packages/adapter-network-rakuten/` as hand-written code that passes the shared `runNetworkConnectorContract` suite. Each further network would mean another package. The project owner asked whether networks could instead be added from the dashboard, the way integration platforms such as Zapier let a builder describe an integration (an auth block, then operations with endpoint templates, pagination, and field mappings) that one shared engine runs.

What WP-4.3 showed about Rakuten:

- Declarative in nature: the token request, endpoint paths and query parameters, next-link paging, status maps (for example partnership `active` to approved), and the list of unsupported operations.
- Imperative in nature: reading the Events API as 30-day windows with whole-second dates and a 100-day history limit, building one program from three calls, computing revisions from mapped fields, and refusing a page instead of dropping a row.

The dashboard already has the pieces for accounts: WP-4.4 stores sealed credentials, and WP-4.11 shows network status. No route or form registers an account yet, and the credential store holds one string while Rakuten needs a client ID, a client secret, and an account ID.

## Decision

- Adapters stay code for now. The Rakuten adapter is the reference and is not replaced.
- The direction to evaluate is one declarative connector engine in `packages/adapter-network-declarative/`. It implements `NetworkConnector` by running a network definition: auth, per-operation request and paging, field and status mappings, capability states, and the single https host the credential may be sent to. Logic a definition cannot express is a named hook in the engine, not a script in the definition.
- A spike decides it. The spike builds the engine and a Rakuten definition and passes only if:
  - the engine passes `runNetworkConnectorContract` for Rakuten, and
  - against the same fake upstream, it returns the same results as the hand-written adapter for every contract case and every adapter-specific case (paging, windowing, failures, credential safety), and
  - every hook it needs is network-neutral by name and contract, and the list of hooks is recorded.
- The engine enforces these rules for every definition. A definition cannot weaken them:
  - Every failure is a typed `ConnectorFailure`, and a partial result is never returned as complete.
  - Money becomes `bigint` minor units through the currency exponent, with no float path (ADR-005).
  - The credential is sent only to the host the definition declares, over https, and never reaches a result, error, diagnostic, or log.
  - An operation the definition does not support fails as `unsupported`.
- Definitions are reviewed files in the repo. A definition is used in production only after it passes the contract suite against recorded fixtures.
- The dashboard manages accounts: register and rotate credentials, see connection health, and test a connection with `validateConnection`. This holds whether adapters are code or definitions. Its credential shape (a sealed object whose fields the adapter or definition declares, with `account_ref` as the network's account ID) is set when that work package is written.
- Not decided here:
  - A visual builder, or definitions stored and edited in the database. Either needs its own ADR, because a definition decides where credentials go and how money is mapped.
  - The hook mechanism beyond "named and network-neutral".
  - A second network. Other networks still need an ADR that names them (ADR-013).
  - Per-organization networks or definitions.

## Evidence

- ADR-013 and the Rakuten adapter (PR #143, `packages/adapter-network-rakuten/README.md`): which parts of one real network's API were declarative and which were not.
- Blueprint §3.1 rule 2: ports exist only at real seams, with one fake in `test-kit`. The connector port is already the seam, so a definition engine would be one more adapter behind it.
- `runNetworkConnectorContract` in `packages/test-kit/src/contracts/network-connector.ts`: the quality gate any adapter or engine must pass.
- Integration platforms of the Zapier kind are named by the project owner as prior art. This ADR did not research their internals.

## Revisit trigger

Reopen this decision when the spike reports, when a second network is contracted, or when adding a network by code costs more than the engine would.

## Fallback

If the spike fails, adapters stay code, one package per network, each passing the shared contract suite. The dashboard work for accounts and credentials goes ahead unchanged. This ADR is then superseded by a short ADR that records why the engine did not pay off.
