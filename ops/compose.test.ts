import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const composePath = new URL("./docker-compose.yml", import.meta.url);

const services = [
  { name: "postgres", image: "postgres:16", containerPort: "5432" },
  { name: "redis", image: "redis:7", containerPort: "6379" },
];

test.each(services)("$name runs $image with a usable health check", ({ name, image }) => {
  const compose = parse(readFileSync(composePath, "utf8"));
  const service = compose.services?.[name];
  expect(service?.image).toBe(image);
  expect(Array.isArray(service?.healthcheck?.test)).toBe(true);
  expect(service.healthcheck.test.length).toBeGreaterThanOrEqual(2);
  expect(service.healthcheck.interval).toBeTruthy();
  expect(service.healthcheck.timeout).toBeTruthy();
  expect(service.healthcheck.retries).toBeGreaterThan(0);
});

test.each(services)("$name publishes its port on loopback only", ({ name, containerPort }) => {
  const compose = parse(readFileSync(composePath, "utf8"));
  const ports: string[] = compose.services?.[name]?.ports ?? [];
  expect(ports.length).toBeGreaterThan(0);
  for (const port of ports) {
    expect(port.startsWith("127.0.0.1:")).toBe(true);
    expect(port.endsWith(`:${containerPort}`)).toBe(true);
  }
});
