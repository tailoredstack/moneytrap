# ADR-007: Redirect route view with freshness bound and version check

- Status: Accepted, 2026-10-31 (design revised during WP-0.8; see Revision)
- Date: 2026-10-31
- Spike: WP-0.6 / OZE-3101

## Context

The redirect path must return quickly on a cache hit, deny revoked routes within five seconds, and return a neutral 503 when Redis and Postgres are both unavailable. The latency targets are provisional until WP-0.10 confirms the load profile.

## Decision

Cache a route view containing destination, eligibility, state, version, and `loadedAt`, the time the Postgres read started, in Redis for 60 seconds.

A cache hit is served only when both hold:

1. `now - loadedAt < 3 s`. This bounds staleness from the time of the source read, not from the time of the cache write.
2. If a Redis version key exists for the link, it equals the view's `version`. A mismatch forces a Postgres read.

A missing version key does not force a read on its own. Freshness rule 1 covers that case.

Revocation updates Postgres first, then publishes a monotonic version to Redis. Cache writes never create or refresh the version key. If Redis fails, read Postgres. If both stores fail, return 503 without `Location`. Write a click event to a Postgres outbox asynchronously so the redirect response does not wait for that write.

## Revision

The spike design (WP-0.6) let `put` publish the version key with a three-second TTL. A cache write that stalled past that TTL could republish an older version after the newer key had expired, and the stale view was then served for up to another three seconds. That breaks the five-second revocation target. This ADR replaces the spike rule with the two conditions above. A write that stalls cannot extend a view's life, because the bound runs from `loadedAt`, which is set by the source read.

The revised rule costs about the same as the spike. A hot route still reads Postgres about once every three seconds, as the spike did.

## Spike evidence

The [WP-0.6 results](../../spikes/redirect/results.json) come from the compiled Bun binary against isolated Docker Compose Postgres 16 and Redis 7. The local profile used one hot token, 1,000 requests, and 16 concurrent HTTP clients on an Apple M3 Pro. HTTP round-trip samples include client overhead.

| Check | Result | Provisional target |
|---|---:|---:|
| Cache-hit p95 / p99 | 10.83 / 15.04 ms | ≤ 50 / 150 ms |
| With 500 ms click-write delay, p95 / p99 | 3.09 / 4.91 ms | ≤ 50 / 150 ms, p95 within 5 ms of baseline |
| Revoke to denied response | 20.67 ms | ≤ 5,000 ms |
| Redis and Postgres stopped | 503; no `Location` | 503; no `Location` |
| Click outbox rows after each phase drains | 1,001 / 2,002 | Every tested redirect eventually recorded |

The test and runner are in `spikes/redirect/`. The first outage run revealed an unhandled idle Postgres pool error that exited the server; the pool error listener fixed it, and the full harness then passed.

## Consequences and gates

- **Gate for WP-5.4 (route view and Redis cache):** implement the Revision rule and add a test that stalls the cache write past three seconds after a revocation. The test must show the revoked route denied within five seconds. The spike code still implements the old rule and does not exercise this race.
- **Gate for WP-5.4 and WP-5.5:** test the Revision rule under the signed-off 10,000-link, 80/20 hot/cold load profile and the true revocation command path.
- Freshness depends on clocks. `loadedAt` is set by the reading host and compared on the host that serves the hit, so the design assumes host clocks agree within tens of milliseconds. WP-5.4 must record that assumption, and WP-5.4 or WP-5.5 must check it with a skew test before the design is relied on across hosts.
- The click outbox insertion is scheduled after resolution and can be lost if the process exits before the write finishes. Until WP-5.8 ships a durable ingestion design, click counts are best-effort. WP-5.8 must measure loss and retry behavior.
- This spike does not prove monthly availability, cross-host latency, or a production queue relay. ADR-004 covers the relay.
- This spike uses Elysia 1.4.30, the version available in this checkout. ADR-002 owns the Elysia 2 decision, and WP-5.4 must measure the redirect route on the framework that ADR selects.

## Fallback

If the Revision gate fails in WP-5.4, drop the Redis route view for redirects and read Postgres on every request. Re-measure the latency targets before the decision is changed again.
