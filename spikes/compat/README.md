# WP-0.7: library compatibility spike

This spike checks that each library in Blueprint §12 (Spike C) works under `bun test` and inside the compiled binary. It is discarded after the ADR review; nothing here is production code.

From the repository root:

```sh
bun install --frozen-lockfile
COMPAT_DATABASE_URL=postgres://moneytrap:moneytrap@127.0.0.1:5433/moneytrap \
COMPAT_REDIS_URL=redis://127.0.0.1:6380 \
  bun test spikes/compat/compat.test.ts
```

Without `COMPAT_DATABASE_URL` the suite is skipped, so the root `bun test` in CI stays green. The suite runs each check twice: in-process (`bun test`) and against `dist/moneytrap-compat` built by `build.ts` (`--compile`). `--migrate` runs the Kysely and Better Auth migrations and exits.

## Results

| Library | Check | `bun test` | Compiled binary |
|---|---|---|---|
| Elysia 2 (`2.0.0-rc.1`) | Body validation maps to `VALIDATION_FAILED`; domain errors map to status and code | Pass | Pass |
| Elysia 2 | Plugin hooks stay local and do not leak to other routes | Pass | Pass |
| `@elysiajs/openapi` (`2.0.0-exp.0`) | `GET /openapi/json` lists routes | Pass | Pass |
| Better Auth (`1.7.14`) + Kysely + `pg` | Sign-up and session through the Elysia mount | Pass | Pass |
| Better Auth organization plugin | Creates an organization | Pass | Pass |
| Better Auth two-factor plugin | Enables TOTP | Pass | Pass |
| `@better-auth/api-key` (`1.7.14`) | Key resolves a session via `x-api-key` | Pass | Pass |
| Kysely (`0.29.7`) + `pg` | Insert and read | Pass | Pass |
| `redis` (`6.3.1`) | Cache round trip | Pass | Pass |
| BullMQ (`6.5.2`) + `ioredis` (`5.10.0`) | Enqueue from a request; worker completes the job | Pass | Pass |
| OpenTelemetry (`sdk-trace-base` 2.12, OTLP HTTP exporter 0.223.0) | Span reaches an OTLP HTTP collector | Pass | Pass |

Run on macOS arm64 with Bun 1.4.4, PostgreSQL 18 (port 5433), and a local Redis 7 on port 6379 (`COMPAT_REDIS_URL` pointed there; the compose default is 6380). Hardware and the Linux run still need recording (see TP-W0-018, TP-W0-019).

## Findings that change plans

- **BullMQ needs `ioredis`.** BullMQ 6 rejects `node-redis` clients and throws `BullMQ could not load the optional 'ioredis' package`. Moneytrap will ship two Redis clients unless the queue adapter is the only place `ioredis` is allowed.
- **Kysely 0.29 moved the migrator.** `Migrator` and migration types now import from `kysely/migration`. The root export is deprecated.
- **Kysely version pins conflict.** `better-auth@1.7.14` requires `kysely` `^0.28.17 || ^0.29`. WP-0.5 pins `kysely` `0.28.8`, which Better Auth rejects. WP-0.5 needs bumping before both spikes are combined.
- **Better Auth CLI has no 1.7.x release.** `@better-auth/cli` stops at `1.4.22`. Schema and migrations come from `better-auth/db/migration` (`getMigrations`) at the same version.
- **Better Auth reports missing tables at startup.** It logs `Database schema mismatch` before migrations run. This is expected on a fresh database; `--migrate` creates the tables.
- **Elysia 2 route signature.** Route hooks come before the handler: `.post(path, hook, handler)`. The 1.x order throws at registration.
- **Elysia 2 has no stable OpenAPI plugin.** The only 2.x build of `@elysiajs/openapi` is `2.0.0-exp.0`. It passed here, but an experimental dependency is a risk for the ADR.
- **The API key plugin has no verify endpoint.** Keys are checked through `x-api-key` on authenticated routes, with `enableSessionForAPIKeys: true`.
- **OpenTelemetry versions must match.** The OTLP exporter `0.300.0` pulls `sdk-trace` 3.x, which needs `@opentelemetry/api` 1.10 and clashes with `sdk-trace-base` 2.12 (`api <1.10`). Using exporter `0.223.0` resolves it.

## Fallbacks

No library failed its checks, so no fallback ADR is needed. Elysia 2 and `@elysiajs/openapi` are pre-release, and the ADR should record that as a risk with the rc and exp pins.
