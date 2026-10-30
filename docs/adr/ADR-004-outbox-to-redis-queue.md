# ADR-004: Postgres outbox, relayed to a Redis queue, at-least-once with consumer dedupe

- Status: Accepted, 2026-10-31 (queue proven; relay and dedupe gated to WP-1.7)
- Date: 2026-10-31
- Spike: WP-0.6 (redirect path), WP-0.7 (library compatibility)

## Context

A domain change and the job it creates must commit together (Blueprint §1, §5.4). Redis is never the source of truth, so the queue has to be fed from Postgres.

## Decision

- Writers insert an outbox row in the same transaction as the state change.
- A relay in `apps/server/src/worker` publishes outbox rows to a BullMQ queue. Delivery is at-least-once. Consumers dedupe by `event_id` (WP-1.7).
- The queue library is BullMQ `6.5.2` on `ioredis` `5.10.0`. BullMQ 6 rejects `node-redis` clients and throws when `ioredis` is missing.
- In production code, `ioredis` is the only Redis client. The route-view cache, rate limits, and the queue all use it, so the binary does not ship two clients. The compat spike also installs `redis` 6.3.1 to test that library's cache round trip. That spike is discarded and is not production code, but its binary does ship both clients. Remove `redis` from the compat spike or accept the duplicate only inside that spike.

## Evidence

- WP-0.7: a request enqueued a BullMQ job through `ioredis`, and a worker completed it, under both `bun test` and the compiled binary.
- WP-0.6: outbox rows were written after the redirect response. Row counts were exact (1,001 and 2,002 after each phase drained). In one run, the delayed-write p95 (3.09 ms) was below the baseline p95 (10.83 ms). The harness checks only that the delayed p95 is not more than 5 ms above baseline, and the baseline runs first. Warm-up can make the baseline look slower, so a regression of up to about 12.7 ms would still pass. This is a single-run, one-sided comparison, not proof that the response is unaffected by a delayed write.

## Not yet proven

- The transactional relay (outbox to queue) and consumer dedupe have not been run. WP-0.6 wrote outbox rows directly, and WP-0.7 enqueued directly from a request.
- The redirect click write is not durable. ADR-007 records that it can be lost if the process exits first. WP-5.8 decides click ingestion.

These are acceptance criteria for WP-1.7, not reasons to reject the design. WP-5.4 must also rerun the delayed-write comparison with alternating run order and a two-sided tolerance before the latency claim is relied on.

## Fallback

If BullMQ fails in the compiled binary, or cannot run against the Redis deployment, implement the same queue port on Redis Streams through `ioredis` (`XADD` and `XREADGROUP`). `ioredis` stays the only client, so the fallback adds no second client.
