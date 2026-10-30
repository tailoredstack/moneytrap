import { arch, cpus, platform } from "node:os";
import { resolve } from "node:path";
import { sql } from "kysely";
import { connect, redisCache, revoke } from "./src/adapters";

const root = resolve(import.meta.dir, "../..");
const binary = resolve(import.meta.dir, "dist/redirect-spike");
const project = `moneytrap_redirect_${process.pid}`;
const token = `spike-${process.pid}`;

function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = server.port;
  server.stop(true);
  if (port === undefined) throw new Error("could not allocate a local port");
  return port;
}

const pgPort = freePort();
const redisPort = freePort();
const httpPort = freePort();
const databaseUrl = `postgres://moneytrap:moneytrap@127.0.0.1:${pgPort}/moneytrap`;
const redisUrl = `redis://127.0.0.1:${redisPort}`;
const serviceUrl = `http://127.0.0.1:${httpPort}/r/${token}`;
const env = {
  ...process.env,
  MONEYTRAP_PG_PORT: String(pgPort),
  MONEYTRAP_REDIS_PORT: String(redisPort),
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  PORT: String(httpPort),
};
const compose = ["docker", "compose", "-p", project, "-f", "ops/docker-compose.yml"];

async function run(args: string[], runEnv = env) {
  const child = Bun.spawn(args, { cwd: root, env: runEnv, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`${args.join(" ")} exited ${code}\n${stdout}\n${stderr}`);
  return stdout;
}

async function request() {
  const response = await fetch(serviceUrl, { redirect: "manual", signal: AbortSignal.timeout(3000) });
  await response.arrayBuffer();
  return response;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return await request();
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error("compiled server did not start within 5 seconds");
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number((sorted[Math.ceil(sorted.length * p) - 1] ?? NaN).toFixed(2));
}

async function load(count: number, concurrency: number) {
  const times: number[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        next++;
        const start = performance.now();
        const response = await request();
        if (response.status !== 302) throw new Error(`load request returned ${response.status}`);
        times.push(performance.now() - start);
      }
    }),
  );
  return {
    count,
    concurrency,
    p95Ms: percentile(times, 0.95),
    p99Ms: percentile(times, 0.99),
    maxMs: Number(Math.max(...times).toFixed(2)),
  };
}

let server: ReturnType<typeof Bun.spawn> | undefined;
const startServer = async (clickDelayMs = 0) => {
  server = Bun.spawn([binary], {
    cwd: root,
    env: { ...env, CLICK_WRITE_DELAY_MS: String(clickDelayMs) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const response = await waitForServer();
  if (response.status !== 302) throw new Error(`warmup returned ${response.status}`);
};
const stopServer = async () => {
  if (!server) return;
  server.kill();
  await server.exited;
  server = undefined;
};

async function outboxCount(db: ReturnType<typeof connect>["db"]) {
  const rows = await sql<{ count: string }>`SELECT count(*)::text AS count FROM redirect_spike_outbox`.execute(db);
  return Number(rows.rows[0]?.count ?? "0");
}

async function waitForOutbox(db: ReturnType<typeof connect>["db"], expected: number) {
  const deadline = performance.now() + 10_000;
  let count = await outboxCount(db);
  while (count < expected && performance.now() < deadline) {
    await Bun.sleep(20);
    count = await outboxCount(db);
  }
  if (count < expected) throw new Error(`outbox has ${count} click events; expected at least ${expected}`);
  return count;
}

try {
  await run([...compose, "up", "-d", "--wait"]);
  await run(["bun", "build", "--compile", "spikes/redirect/src/index.ts", "--outfile", binary]);
  await run([binary, "--migrate"]);
  const { db, redis, close } = connect(databaseUrl, redisUrl);
  try {
    await sql`INSERT INTO redirect_spike_links (id, token, destination, state, eligible, version)
      VALUES (${token}, ${token}, 'https://example.com/offer', 'active', true, 1)`.execute(db);
    await redis.connect();
    await redisCache(redis).put({
      id: token,
      token,
      destination: "https://example.com/offer",
      state: "active",
      eligible: true,
      version: 1,
    });
    await startServer();
    const baseline = await load(1000, 16);
    if (baseline.p95Ms > 50 || baseline.p99Ms > 150)
      throw new Error(`latency target failed: ${JSON.stringify(baseline)}`);
    const outboxClicks = await waitForOutbox(db, 1001);

    await stopServer();
    await startServer(500);
    const delayedClick = await load(1000, 16);
    if (delayedClick.p95Ms > 50 || delayedClick.p99Ms > 150)
      throw new Error(`delayed-click target failed: ${JSON.stringify(delayedClick)}`);
    const outboxClicksAfterDelay = await waitForOutbox(db, outboxClicks + 1001);

    const revokedAt = performance.now();
    if (!(await revoke(db, redisCache(redis), token))) throw new Error("revoke could not find route");
    let denied = await request();
    while (denied.status !== 410 && performance.now() - revokedAt < 5000) {
      await Bun.sleep(25);
      denied = await request();
    }
    const revocationMs = Number((performance.now() - revokedAt).toFixed(2));
    if (denied.status !== 410 || denied.headers.has("location") || revocationMs > 5000) {
      throw new Error(`revocation failed after ${revocationMs} ms: ${denied.status}`);
    }

    await run([...compose, "stop", "redis", "postgres"]);
    const outage = await request();
    if (outage.status !== 503 || outage.headers.has("location")) {
      throw new Error(`dual-store outage returned ${outage.status} with Location=${outage.headers.get("location")}`);
    }
    const results = {
      measuredAt: new Date().toISOString(),
      runtime: `Bun ${process.versions.bun}`,
      host: `${platform()} ${arch()} ${cpus()[0]?.model ?? "unknown CPU"}`,
      profile:
        "single hot token, 1000 requests, 16 concurrent clients, local Docker Compose; HTTP round-trip time includes client overhead",
      targets: { p95Ms: 50, p99Ms: 150, revocationMs: 5000 },
      baseline,
      outboxClicksAfterBaseline: outboxClicks,
      delayedClick500Ms: delayedClick,
      outboxClicksAfterDelay,
      revocationMs,
      dualStoreOutage: { status: outage.status, locationHeader: outage.headers.get("location") },
    };
    await Bun.write(resolve(import.meta.dir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await close();
  }
} finally {
  await stopServer();
  await run([...compose, "down", "-v", "--remove-orphans"]);
}
