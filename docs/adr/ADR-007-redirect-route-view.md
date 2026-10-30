# ADR-007: Redirect route view and version check

- Status: Proposed (WP-0.8 will accept or reject)
- Date: 2026-10-31
- Spike: WP-0.6 / OZE-3101

## Context

The redirect path must return quickly on a cache hit, deny revoked routes within five seconds, and return a neutral 503 when Redis and Postgres are both unavailable. The latency targets are provisional until WP-0.10 confirms the load profile.

## Proposed decision

Cache a route view containing destination, eligibility, state, and version in Redis for 60 seconds. On every hit, compare its version with a separate Redis version key. A mismatch or missing version key forces a Postgres read. Expire the version key after three seconds, so a failed invalidation cannot leave a cached allow valid for the full route-view TTL. Revocation updates Postgres first, then publishes a monotonic version to Redis. If Redis fails, read Postgres; if both stores fail, return 503 without `Location`. Write a click event to a Postgres outbox asynchronously so the redirect response does not wait for that write.

## Spike evidence

The [WP-0.6 results](../../spikes/redirect/results.json) come from the compiled Bun binary against isolated Docker Compose Postgres 16 and Redis 7. The local profile used one hot token, 1,000 requests, and 16 concurrent HTTP clients on an Apple M3 Pro. HTTP round-trip samples include client overhead.

| Check | Result | Provisional target |
|---|---:|---:|
| Cache-hit p95 / p99 | 6.48 / 9.57 ms | ≤ 50 / 150 ms |
| With 500 ms click-write delay, p95 / p99 | 2.44 / 3.29 ms | ≤ 50 / 150 ms, p95 within 5 ms of baseline |
| Revoke to denied response | 5.17 ms | ≤ 5,000 ms |
| Redis and Postgres stopped | 503; no `Location` | 503; no `Location` |
| Click outbox rows after each phase drains | 1,001 / 2,002 | Every tested redirect eventually recorded |

The test and runner are in `spikes/redirect/`. The first outage run revealed an unhandled idle Postgres pool error that exited the server; the pool error listener fixed it, and the full harness then passed.

## Consequences and open work

The three-second version key bounds stale allows when the invalidation write fails, but it also forces a Postgres read at least every three seconds per active route. WP-5.4 and WP-5.5 must test this under the signed-off 10,000-link, 80/20 hot/cold load profile and the true revocation command path. This spike does not prove monthly availability, cross-host latency, or a production queue relay.

Open limit: a cache write that stalls past the three-second version TTL can republish an older version after the newer version key expires. `put` then re-arms that stale view for up to another three seconds, which can exceed the five-second revocation target. The spike harness does not exercise this race. This must be fixed or the design revised before the ADR is accepted.

The click outbox insertion is scheduled after resolution and can be lost if the process exits before the write finishes. WP-5.8 must choose a durable ingestion design and measure loss and retry behavior. ADR-004 remains Proposed until the outbox relay and queue are proven. WP-0.8 owns the final ADR decision.

This spike uses Elysia 1.4.30, the version available in this checkout. WP-0.7 and ADR-002 own the separate Elysia 2 compatibility decision.
