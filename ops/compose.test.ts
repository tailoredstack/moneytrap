import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const composePath = new URL("./docker-compose.yml", import.meta.url);

const services = [
  { name: "postgres", image: "postgres:16", containerPort: "5432" },
  { name: "redis", image: "redis:7", containerPort: "6379" },
];

const mailpit = { name: "mailpit", image: "axllent/mailpit:v1.29", containerPorts: ["1025", "8025"] };

test.each([...services, mailpit])("$name runs $image with a usable health check", ({ name, image }) => {
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

// Mailpit publishes two ports, SMTP and the web UI. Both stay on loopback, and their defaults avoid the ports the local
// stack already uses: 3000 (server), 5190 (web), 5433 (Postgres), and 6380 (Redis).
test("mailpit publishes SMTP and its web UI on loopback only, on ports the local stack does not use", () => {
  const compose = parse(readFileSync(composePath, "utf8"));
  const ports: string[] = compose.services?.[mailpit.name]?.ports ?? [];
  expect(ports.map((port) => port.split(":").at(-1)).sort()).toEqual(mailpit.containerPorts);
  for (const port of ports) {
    expect(port.startsWith("127.0.0.1:")).toBe(true);
    const hostPort = port.match(/:-?(\d+)\}?:\d+$/)?.[1];
    expect(hostPort).toBeDefined();
    expect(["3000", "5190", "5433", "6380"]).not.toContain(hostPort);
  }
});
