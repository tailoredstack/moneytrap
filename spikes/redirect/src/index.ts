import { connect, migrate, postgresStore, redisCache } from "./adapters";
import { createApp } from "./app";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://moneytrap:moneytrap@127.0.0.1:5433/moneytrap";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6380";
const { db, redis, close } = connect(databaseUrl, redisUrl);
if (process.argv.includes("--migrate")) {
  await migrate(db);
  await close();
} else {
  const port = Number(process.env.PORT ?? "3006");
  createApp(postgresStore(db, Number(process.env.CLICK_WRITE_DELAY_MS ?? "0")), redisCache(redis)).listen(port);
  console.log(`redirect spike listening on ${port}`);
}
