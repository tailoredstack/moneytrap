import Redis from "ioredis";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { Cache, RouteView, Store } from "./core";

type DB = {
  redirect_spike_links: RouteView;
  redirect_spike_outbox: { id: string; kind: string; link_id: string; request_id: string; created_at: Date };
};

export function connect(databaseUrl: string, redisUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 500, max: 12 });
  // A stopped Postgres sends errors to idle clients; do not let that kill the redirect server.
  pool.on("error", () => {});
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 500,
    enableOfflineQueue: false,
  });
  redis.on("error", () => {});
  return {
    db,
    redis,
    async close() {
      await Promise.all([db.destroy(), redis.quit().catch(() => redis.disconnect())]);
    },
  };
}

export async function migrate(db: Kysely<DB>) {
  await sql`CREATE TABLE IF NOT EXISTS redirect_spike_links (
    id text PRIMARY KEY, token text UNIQUE NOT NULL, destination text NOT NULL,
    state text NOT NULL CHECK (state IN ('active', 'revoked')),
    eligible boolean NOT NULL, version integer NOT NULL DEFAULT 1
  )`.execute(db);
  await sql`CREATE TABLE IF NOT EXISTS redirect_spike_outbox (
    id text PRIMARY KEY, kind text NOT NULL, link_id text NOT NULL,
    request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`.execute(db);
}

export function postgresStore(db: Kysely<DB>, clickDelayMs = 0): Store {
  return {
    async byToken(token) {
      return (
        (await db.selectFrom("redirect_spike_links").selectAll().where("token", "=", token).executeTakeFirst()) ?? null
      );
    },
    async writeClick(view, requestId) {
      if (clickDelayMs > 0) await Bun.sleep(clickDelayMs);
      await db
        .insertInto("redirect_spike_outbox")
        .values({
          id: crypto.randomUUID(),
          kind: "click",
          link_id: view.id,
          request_id: requestId,
          created_at: new Date(),
        })
        .execute();
    },
  };
}

const viewKey = (token: string) => `redirect-spike:view:${token}`;
const versionKey = (id: string) => `redirect-spike:version:${id}`;
const MAX_VERSION_SCRIPT = `local current = tonumber(redis.call('GET', KEYS[1]) or '-1')
local next = tonumber(ARGV[1])
if next >= current then redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) end
return 1`;

export function redisCache(redis: Redis): Cache & { publishVersion(id: string, version: number): Promise<void> } {
  return {
    async view(token) {
      const value = await redis.get(viewKey(token));
      return value ? (JSON.parse(value) as RouteView) : null;
    },
    async version(id) {
      const value = await redis.get(versionKey(id));
      return value === null ? null : Number(value);
    },
    async put(view) {
      await redis.multi().set(viewKey(view.token), JSON.stringify(view), "EX", 60).exec();
      await this.publishVersion(view.id, view.version);
    },
    async publishVersion(id, version) {
      // A missing version key forces a Postgres read within three seconds.
      await redis.eval(MAX_VERSION_SCRIPT, 1, versionKey(id), String(version), "3");
    },
  };
}

export async function revoke(db: Kysely<DB>, cache: ReturnType<typeof redisCache>, token: string) {
  const row = await db
    .updateTable("redirect_spike_links")
    .set({ state: "revoked", version: sql`version + 1` })
    .where("token", "=", token)
    .returning(["id", "version"])
    .executeTakeFirst();
  if (!row) return false;
  try {
    await cache.publishVersion(row.id, row.version);
  } catch {
    /* three-second version expiry bounds staleness */
  }
  return true;
}
