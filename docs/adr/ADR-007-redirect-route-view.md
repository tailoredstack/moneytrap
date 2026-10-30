# ADR-007: Redirect route view with freshness bound and version check

- Status: Accepted, 2026-10-31 (design revised during WP-0.8; see Revision)
- Date: 2026-10-31
- Spike: WP-0.6 / OZE-3101

## Context

The redirect path must return quickly on a cache hit, deny revoked routes within five seconds, and return a neutral 503 when Redis and Postgres are both unavailable. The latency targets are provisional until WP-0.10 confirms the load profile.

## Decision

Cache a route view containing destination, eligibility, state, version, and `loadedAt`, the time the Postgres read started, in Redis for 60 seconds.

A cache hit is served only when both hold:

1. `0 <= now - loadedAt < 3 s`, where both `now` and `loadedAt` come from the Redis server clock (`TIME`), not from an application host. `loadedAt` is read from Redis `TIME` before the primary read starts. The put stores that value unchanged; it never re-stamps `loadedAt` at write time. A stalled write therefore keeps the older timestamp and cannot extend the view. The source read must go to the Postgres primary, and it must start after `loadedAt` is captured. A replica can return a snapshot older than the timestamp, so replica reads are not allowed for the redirect source read. Under those conditions the bound runs from the source read, not from the cache write. A Lua script performs the check, so the hit path needs one Redis round trip. The check runs when Redis answers, so a view that passes just under three seconds can still be sent a few milliseconds later. The effective bound is three seconds plus the time from the check to the response. The five-second revocation budget absorbs that margin. Because no host clock is compared, skew between app hosts cannot extend a view.
2. If a Redis version key exists for the link, it equals the view's `version`. A mismatch forces a Postgres read.

A missing version key does not force a read on its own. Freshness rule 1 covers that case.

Any change that affects routing, including revocation, suspension, and eligibility or destination changes, updates Postgres first. It then publishes a monotonic version to Redis directly from the command after commit. This revises Blueprint §5.3 item 3, which routes invalidation through the outbox. The direct publish is safe because the freshness bound in rule 1 does not depend on it: a missed publish only delays the change to the three-second bound. Cache writes never create or refresh the version key. If Redis fails, read Postgres. If both stores fail, return 503 without `Location`. Write a click event to the queue asynchronously, not inline, so the redirect response does not wait for that write (Blueprint §5.3 item 6). The spike wrote a Postgres outbox row as a stand-in. WP-5.8 chooses the durable ingestion path.

## Revision

The spike design (WP-0.6) let `put` publish the version key with a three-second TTL. A cache write that stalled past that TTL could republish an older version after the newer key had expired, and the stale view was then served for up to another three seconds. That breaks the five-second revocation target. This ADR replaces the spike rule with the two conditions above. A write that stalls cannot extend a view's life, because the bound runs from `loadedAt`, which is set by the source read.

The revised rule is expected to read Postgres about once every three seconds per hot route, as the spike did. That cost is not measured. WP-5.4 measures it.

## Spike evidence

The [WP-0.6 results](../../spikes/redirect/results.json) come from the compiled Bun binary against isolated Docker Compose Postgres 16 and Redis 7. The local profile used one hot token, 1,000 requests, and 16 concurrent HTTP clients on an Apple M3 Pro. HTTP round-trip samples include client overhead.

| Check | Result | Provisional target |
|---|---:|---:|
| Cache-hit p95 / p99 | 10.83 / 15.04 ms | ≤ 50 / 150 ms |
| With 500 ms click-write delay, p95 / p99 | 3.09 / 4.91 ms | ≤ 50 / 150 ms, p95 within 5 ms of baseline |
| Revoke to denied response | 20.67 ms | ≤ 5,000 ms |
| Redis and Postgres stopped | 503; no `Location` | 503; no `Location` |
| Click outbox rows after each phase drains | 1,001 / 2,002 | Every tested redirect eventually recorded |

The client versions in that run are `ioredis` 6.0.0, `pg` 8.x (`^8.23.1`), and `kysely` `^0.29.7`. They differ from the pins in ADR-003 (`pg` 8.16.3) and ADR-004 (`ioredis` 5.10.0). The numbers describe the spike's stack, not the production pins. The revocation figure is a single run, and the table presents it without spread. The harness checks outage and revocation once each. Outage and crash cases were not measured. Outbox counts were checked on fault-free runs only.

The test and runner are in `spikes/redirect/`. The first outage run revealed an unhandled idle Postgres pool error that exited the server; the pool error listener fixed it, and the full harness then passed.

## Consequences and gates

- **Gate for WP-5.4 (route view and Redis cache):** implement the Revision rule and add a test that stalls the cache write past three seconds after a revocation. The test must show the revoked route denied within five seconds. The spike code still implements the old rule and does not exercise this race.
- **Gate for WP-5.4 and WP-5.5:** test the Revision rule under the signed-off 10,000-link, 80/20 hot/cold load profile and the true revocation command path.
- Clock source: the freshness check uses only the Redis server clock. Comparing a host clock with a reader's clock would let a lagging serving host extend a view by its lag, so the design avoids that comparison. WP-5.4 must test a serving host with a skewed clock to show the check does not depend on it.
- Gate for the spike numbers: WP-5.4 reruns the redirect harness with the production client pins from ADR-003 and ADR-004, and records them in the results.
- The click outbox insertion is scheduled after resolution and can be lost if the process exits before the write finishes. Until WP-5.8 ships a durable ingestion design, click counts are best-effort. WP-5.8 must measure loss and retry behavior.
- This spike does not prove monthly availability, cross-host latency, or a production queue relay. ADR-004 covers the relay.
- This spike uses Elysia 1.4.30, the version available in this checkout. ADR-002 owns the Elysia 2 decision, and WP-5.4 must measure the redirect route on the framework that ADR selects.

## Fallback

If the Revision gate fails in WP-5.4, drop the Redis route view for redirects and read Postgres on every request. Re-measure the latency targets before the decision is changed again.
