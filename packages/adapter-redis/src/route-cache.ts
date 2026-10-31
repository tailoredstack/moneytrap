import type { RouteCache, RouteView } from "@moneytrap/app";
import type { Id } from "@moneytrap/domain";
import type IORedis from "ioredis";

// ADR-007. A view is served only while it is younger than this on the Redis clock.
export const ROUTE_VIEW_MAX_AGE_MS = 3000;
// The view entry expires after this, which bounds memory. Freshness is decided by the age check, not by this TTL.
const VIEW_TTL_SECONDS = 60;

const VIEW_PREFIX = "route:view:";
const VERSION_PREFIX = "route:version:";

// Both clocks come from Redis, so the age is computed from one clock only. A negative age (loadedAt in the future) is
// refused too. The version key is compared only when it exists: a missing key falls to the age bound.
const GET_SCRIPT = `local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local entry = cjson.decode(raw)
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local age = now - entry.loadedAt
if age < 0 or age >= tonumber(ARGV[1]) then return false end
local published = redis.call('GET', ARGV[2] .. entry.linkId)
if published and tonumber(published) ~= entry.version then return false end
return raw`;

// Moves a link's version key forward only. A lower or equal version never overwrites a newer one.
const PUBLISH_SCRIPT = `local current = tonumber(redis.call('GET', KEYS[1]) or '-1')
if tonumber(ARGV[1]) > current then redis.call('SET', KEYS[1], ARGV[1]) end
return 1`;

type StoredView = RouteView & { loadedAt: number };

export function createRouteCache(connection: IORedis): RouteCache {
  return {
    async readServerTime() {
      const [seconds, microseconds] = await connection.time();
      return Number(seconds) * 1000 + Math.floor(Number(microseconds) / 1000);
    },
    async get(token) {
      const raw = (await connection.eval(
        GET_SCRIPT,
        1,
        `${VIEW_PREFIX}${token}`,
        String(ROUTE_VIEW_MAX_AGE_MS),
        VERSION_PREFIX,
      )) as string | null;
      if (!raw) return null;
      const stored = JSON.parse(raw) as StoredView;
      return {
        linkId: stored.linkId,
        destination: stored.destination,
        state: stored.state,
        eligible: stored.eligible,
        decision: stored.decision,
        version: stored.version,
      };
    },
    async put(token, view, loadedAt) {
      const stored: StoredView = { ...view, loadedAt };
      await connection.set(`${VIEW_PREFIX}${token}`, JSON.stringify(stored), "EX", VIEW_TTL_SECONDS);
    },
    async publishVersion(linkId: Id<"link">, version) {
      await connection.eval(PUBLISH_SCRIPT, 1, `${VERSION_PREFIX}${linkId}`, String(version));
    },
  };
}
