# WP-0.5: binary shape spike

This spike builds one executable containing an Elysia 2 route, a React page, and a statically imported Kysely migration. The migration runs only with `--migrate` and needs `DATABASE_URL`.

From the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd spikes/binary build
PORT=3000 ./dist/moneytrap-spike
DATABASE_URL=postgres://moneytrap:moneytrap@127.0.0.1:5433/moneytrap ./dist/moneytrap-spike --migrate
```

The runtime executable needs neither Bun nor files from this repository. The browser script and HTML are embedded into it. Set `BINARY_SPIKE_DATABASE_URL` to a fresh PostgreSQL database to exercise the compiled migration in `bun test spikes/binary/spike.test.ts`; without that variable, the database test is skipped.

Elysia 2 has no stable `2.0.0` release yet, so this spike pins `2.0.0-rc.1`. The production dependency choice remains subject to the compatibility spike and ADR review.
