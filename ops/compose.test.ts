import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { parse } from "yaml";

const composePath = new URL("./docker-compose.yml", import.meta.url);

test("local infrastructure exposes healthy Postgres 16 and Redis 7", () => {
  const compose = parse(readFileSync(composePath, "utf8"));

  for (const [name, image] of [
    ["postgres", "postgres:16"],
    ["redis", "redis:7"],
  ]) {
    const service = compose.services?.[name];
    expect(service?.image).toBe(image);
    expect(service?.healthcheck?.test).toBeTruthy();
    expect(service?.ports?.length).toBeGreaterThan(0);
  }
});
