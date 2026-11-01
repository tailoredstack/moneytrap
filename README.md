# Moneytrap

## Local development

You need Bun 1.4.4 and Docker with Compose v2.

Run the one-time setup from the repo root:

```sh
bun run setup
```

It is safe to run again. Each step prints `skipped` when it is already done:

1. Creates each missing `.env` from its `.env.example`. An existing `.env` is never overwritten.
2. Generates `BETTER_AUTH_SECRET` in `apps/server/.env` when it is still the placeholder.
3. Starts Postgres (127.0.0.1:5433) and Redis (127.0.0.1:6380) with `ops/docker-compose.yml`.
4. Installs dependencies with `bun install`.
5. Applies pending migrations with `bun run db:migrate`.
6. Seeds the dev organization and owner with `bun run seed`.

Then start the server and the web app with `bun run dev`.

The web dev server proxies `/api` to the server on `PORT` (default 3000, read from `apps/server/.env`). Open the app on the web dev server's port, not the server's, so the `/api` calls and the Better Auth session reach the server.

The steps can also run on their own. `bun run db:migrate` reads `DATABASE_URL` from the root `.env`, and `bun run seed` inserts the dev rows. The seed is idempotent, so a second run inserts nothing and does not reset the password.

To set up one package by hand, run its `setup` script (for example `bun run setup` in `apps/server`). `apps/web` has no `setup` script because it needs no one-time work.

### Dev owner (local use only)

| Field    | Value                           |
| -------- | ------------------------------- |
| Email    | `owner@moneytrap.test`          |
| Password | `dev-only-moneytrap-password`   |

This password is committed to the repo on purpose, and it is for local development only. Never seed a shared or deployed database with it.
