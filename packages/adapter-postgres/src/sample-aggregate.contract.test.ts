import { runSampleAggregateContract } from "@moneytrap/test-kit/src/contracts/aggregate-store";
import { FakeSampleAggregateStore } from "@moneytrap/test-kit/src/fakes/sample-aggregate";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;

runSampleAggregateContract([
  {
    name: "fake",
    async open() {
      return { store: new FakeSampleAggregateStore(), async close() {} };
    },
  },
  ...(databaseUrl
    ? [
        {
          name: "Postgres",
          async open() {
            const table = `sample_aggregate_${crypto.randomUUID().replaceAll("-", "")}`;
            const pool = new Pool({ connectionString: databaseUrl });
            const db = new Kysely<{ sample_aggregate: { id: string; value: number } }>({
              dialect: new PostgresDialect({ pool }),
            });
            await sql.raw(`create table "${table}" (id text primary key, value integer not null)`).execute(db);
            const sampleTable = sql.table(table);
            return {
              store: {
                async create(aggregate: { id: string; value: number }) {
                  await sql`insert into ${sampleTable} (id, value) values (${aggregate.id}, ${aggregate.value})`.execute(
                    db,
                  );
                },
                async get(id: string) {
                  const result = await sql<{
                    id: string;
                    value: number;
                  }>`select id, value from ${sampleTable} where id = ${id}`.execute(db);
                  return result.rows[0] ?? null;
                },
                async update(aggregate: { id: string; value: number }) {
                  const result =
                    await sql`update ${sampleTable} set value = ${aggregate.value} where id = ${aggregate.id}`.execute(
                      db,
                    );
                  return result.numAffectedRows === 1n;
                },
              },
              async close() {
                try {
                  await sql.raw(`drop table "${table}"`).execute(db);
                } finally {
                  await db.destroy();
                }
              },
            };
          },
        },
      ]
    : []),
]);
