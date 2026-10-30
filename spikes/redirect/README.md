# WP-0.6 redirect spike

This is a disposable Spike B executable, separate from production route work in WP-5.4–5.6. It resolves `/r/:token` through a Redis route view and version key, falls back to Postgres, and writes a click event to a Postgres outbox without waiting for it before the response. A missing version key forces a source read; the key expires after three seconds to bound stale allows when invalidation cannot be published.

Run from the repository root:

```sh
bun install --frozen-lockfile
bun test spikes/redirect/src/core.test.ts
bun spikes/redirect/verify.ts
```

`verify.ts` creates an isolated Docker Compose project, builds the compiled binary, migrates and seeds its database, measures cache-hit latency and delayed-click latency, checks revocation, and checks 503 after both stores stop. It writes `spikes/redirect/results.json`, then removes its containers and volumes. The load profile and targets are provisional until WP-0.10 signs them off.

For manual use, build with `bun build --compile spikes/redirect/src/index.ts --outfile spikes/redirect/dist/redirect-spike`. The binary reads `DATABASE_URL`, `REDIS_URL`, `PORT`, and optional `CLICK_WRITE_DELAY_MS`; run it with `--migrate` before starting the server. The example service is for local testing and has no management API.
