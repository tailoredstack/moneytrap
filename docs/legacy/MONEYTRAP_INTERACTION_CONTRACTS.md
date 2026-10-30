# Moneytrap — Cross-Capability Interactions and Event Semantics

**Events describe meaningful facts.** They do **not** require a broker, a queue product, microservices, or even asynchronous transport. An implementation may notify another capability through a direct call, a durable internal event, a scheduled reconciliation, or a combination, provided the observable effects are equivalent.

## Event semantics and envelope

A cross-boundary notification SHOULD convey: `fact_type`, `fact_id`, `subject_ref`, `subject_revision`, `occurred_at`, `correlation_ref`, `causation_ref`, `policy_version`, and a privacy-minimized `facts` payload. Transport encoding and delivery strategy are not mandated. Events must not expose passwords, reset proofs, raw API keys, financial instrument details, or upstream account secrets.

**Delivery rules:** duplicates and reordering are expected; consumers deduplicate by stable fact identity and revision. A newer aggregate revision MUST not be overwritten by an older delivery. Version-breaking changes require explicit consumers migration. Failure to process a critical fact remains visible and retryable; unexpected versions are quarantined.

| Fact | Authoritative producer | Consumers / effect | Minimal data | Invariant |
|---|---|---|---|---|
| `identity.registered` | Identity | Notification | identity, locale, challenge ref | Cannot grant monetization before verification |
| `identity.verified` | Identity | Organizations/Publisher | identity, verified_at | Replay does not duplicate publisher |
| `identity.recovery_requested` | Identity | Secure notification | delivery reference | Never propagate raw proof in general event |
| `identity.password_changed` | Identity | Sessions, security notice, audit | identity, auth revision | Old session assurance invalidated |
| `organization.created` | Organization | Publisher lifecycle | org, creator | Exactly one initial owner |
| `membership.changed` | Organization | Authorization | org, principal, current role/version | Revoked access fails closed |
| `publisher.submitted` | Publisher lifecycle | Review | publisher, version, evidence refs | Pending not approved |
| `publisher.reviewed` | Review | Eligibility, notification | publisher, decision, reason | Effective deny honored promptly |
| `property.verified` | Property | Review queue | property, proof method/time | Verified not approved |
| `property.reviewed` | Review | Eligibility, routing | property, policy generation | Revoked property loses eligible routes |
| `partnership.changed` | Network operations | Catalog/eligibility | network, capabilities, authorization state | No production use without approval |
| `catalog.updated` | Network catalog | Eligibility/links | source, changed program IDs, as_of | Source freshness recorded |
| `program.eligibility_changed` | Eligibility | Link/Optimize | program, scope, terms version, reason | Unknown eligibility denies monetization |
| `network.sync_requested` | Network operations | Integration capability | source, cursor/scope | Same cursor replay safe |
| `link.created` | Links | Route views | link, property, policy version | No invalid destination published |
| `link.revoked` | Links | Route views | link, revocation version | Old cached allow does not override revoke |
| `click.observed` | Routing | Attribution/analytics | click, link, route, occurred_at | Deduped logical click; no sale assumption |
| `source.report_received` | Network integration | Conversion normalization | source, report ID, digest/version | Raw evidence reproducible |
| `conversion.changed` | Conversion | Finance and reporting | source transaction/revision, status, amount | Source revision posted once |
| `conversion.adjusted` | Conversion | Finance and reporting | adjustment ID, original ID, delta | Original money movement remains |
| `settlement.matched` | Finance | Balance and statements | receipt, allocation IDs, currency | Only actual verified receipt clears |
| `payout.approved` | Finance | Dispatch | payout/batch, approver, amount | Maker-checker policy preserved |
| `payout.dispatched` | Finance | Provider reconciliation | payout, stable transfer ref | Unknown means no new independent transfer |
| `payout.provider_state_changed` | Provider integration | Finance and notification | payout, provider event ID, status | Conflicting terminal state investigated |
| `webhook.delivery_requested` | Developer platform | External subscriber | endpoint/event ref | Signed/verified if public subscriber |
| `risk.decision_changed` | Risk | Eligibility and routing | scope/ref, decision version | Suppression overrides stale allow |
| `privacy.request_resolved` | Privacy | Audit and notification | request ref, disposition | Legal hold and redaction respected |
| `optimize.policy_changed` | Optimize | Client integrations | property, policy version | Consent/exclusion applied before rewrite |
| `country.activation_changed` | Launch control | Network/links/payout | country, capability, active version | Regions restricted independently |

## Interaction rules

### 1. Identity / permissions

A change to membership or identity assurance MUST take effect at any capability that accesses private or privileged information. The propagation technique is optional; an obsolete session or read replica cannot grant old permissions indefinitely.

### 2. Network/catalog → link generation

A fresh, authorized catalog view provides possible programs. The eligibility evaluator must combine contract and property-level constraints at the point of link creation and again where route revocation or risk requires it. Network-specific information may be fetched on demand, cached, or synchronized; unauthorized route generation is always an error.

### 3. Link resolution → click tracking

Visitor request resolves a currently approved link. Generate or identify a unique click attempt, choose an allowed destination, and make tracking evidence recoverable without delaying the response until heavy analytics completes. When tracking cannot lawfully occur, avoid it. Client retries and internal redelivery cannot turn one click attempt into multiple distinct commissions.

### 4. Conversions → ledger

A source-reported conversion is normalized with stable source transaction identity and source revision. Finance independently tests agreement, currency, amounts, attribution, status and recognition policy before posting immutable balanced movements. Revisions create adjustments linked to prior postings. Reports never determine money authority.

### 5. Settlement → payout

Receipt evidence is matched to source transactions, only eligible cleared value becomes available, and payout reservation is atomic under concurrent requests. Dispatch uses a stable transfer identity, outcome ambiguity is investigated, final provider evidence is reconciled, and the statement captures the complete financial trail.

### 6. Optimize ↔ Connect

Optimize receives property eligibility and publisher rules, proposes candidate monetization changes, and relies on Connect for the actual route and accounting. Disabled consent or exclusion returns `leave_original_unchanged`, never an unauthorized fallback campaign.

## Consistency / failure table

| Boundary | Allowed temporary state | Required recovery | Forbidden state |
|---|---|---|---|
| Identity → notification | Delivery pending | Retry safely, inspect failure | Expose recovery proof in logs |
| Review → route eligibility | Short documented propagation delay | Revalidate/deny revoked scope | Revoked property still monetized indefinitely |
| Redirect → analytics | Analytics projection behind | Replay/deduplicate evidence | Block safe redirect on reporting outage |
| Network → conversion | Source report stale | Mark `as_of`, retry and alert | Infer zero revenue from unavailable report |
| Conversion → finance | Pending finance recognition | Replay source revision | Duplicate postings |
| Settlement → balance | Receipt not fully allocated | Quarantine remainder | Clear more than received |
| Payout → provider | Ambiguous transfer outcome | Query original identity, reconcile | Blind second transfer |
| Optimize → client | Old policy cached | Version and invalidate | Bypass an active deny/opt-out |
