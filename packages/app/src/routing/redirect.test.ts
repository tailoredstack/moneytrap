import { describe, expect, test } from "bun:test";
import { createLink, type Id, type Link } from "@moneytrap/domain";
import type { ClickQueue } from "../ports/click-queue";
import type { ClickObservation } from "../ports/click-store";
import type { RouteCache } from "../ports/route-cache";
import type { RouteSource, RouteSourceRecord } from "../ports/route-source";
import { type RedirectDeps, resolveRedirect } from "./redirect";
import type { RouteView } from "./route-view";

const TOKEN = "lnk_1";
const NOW = new Date("2026-11-01T10:00:00.000Z");

function link(overrides: Partial<Link> = {}): Link {
  const created = createLink({
    id: TOKEN as Id<"link">,
    publisherId: "pub_1" as Id<"publisher">,
    propertyId: "prp_1" as Id<"property">,
    slug: "spring",
    destination: "https://shop.example.com/spring",
    allowedHosts: ["shop.example.com"],
  });
  if (!created.ok) throw new Error("fixture link is invalid");
  return { ...created.value, status: "active", version: 2, ...overrides };
}

// A cache that keeps whatever the use case stores, so the second request is a hit. Freshness is covered in route-view.test.
function memoryCache() {
  const views = new Map<string, RouteView>();
  const cache: RouteCache = {
    async readServerTime() {
      return 1_000_000;
    },
    async get(token) {
      return views.get(token) ?? null;
    },
    async put(token, view) {
      views.set(token, view);
    },
    async publishVersion() {},
  };
  return cache;
}

function setup(source: RouteSourceRecord | null | "throw") {
  const reads: string[] = [];
  const routeSource: RouteSource = {
    async findByToken(token) {
      reads.push(token);
      if (source === "throw") throw new Error("postgres down");
      return source;
    },
  };
  const enqueued: ClickObservation[] = [];
  const clicks: ClickQueue & { failure: Error | null } = {
    failure: null,
    async enqueue(click) {
      if (this.failure) throw this.failure;
      enqueued.push(click);
    },
  };
  const errors: unknown[] = [];
  const deps: RedirectDeps = {
    cache: memoryCache(),
    source: routeSource,
    clicks,
    clock: { now: () => NOW },
    onClickError: (error) => errors.push(error),
  };
  return { deps, reads, enqueued, clicks, errors };
}

// The click is enqueued after the decision, in the background, so a test lets that step run before it reads the queue.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("resolveRedirect (UC13, ADR-007)", () => {
  test("redirects an active, eligible link to its destination and enqueues one click", async () => {
    const { deps, enqueued } = setup({ link: link(), eligible: true });
    const result = await resolveRedirect(deps, TOKEN, "req-1");
    await settle();

    expect(result).toEqual({ kind: "redirect", destination: "https://shop.example.com/spring" });
    expect(enqueued).toEqual([{ dedupKey: "redirect-req-1", linkId: TOKEN as Id<"link">, occurredAt: NOW }]);
  });

  test("serves a repeat request from the cache without a source read", async () => {
    const { deps, reads } = setup({ link: link(), eligible: true });
    await resolveRedirect(deps, TOKEN, "req-1");
    await settle();

    const second = await resolveRedirect(deps, TOKEN, "req-2");
    await settle();

    expect(second.kind).toBe("redirect");
    expect(reads).toEqual([TOKEN]);
  });

  test.each([
    ["revoked", { status: "revoked" as const }, true],
    ["paused", { status: "paused" as const }, true],
    ["draft", { status: "draft" as const }, true],
    ["ineligible", {}, false],
  ])("denies a %s link and enqueues no click", async (_name, overrides, eligible) => {
    const { deps, enqueued } = setup({ link: link(overrides), eligible });
    const result = await resolveRedirect(deps, TOKEN, "req-1");
    await settle();

    expect(result).toEqual({ kind: "denied" });
    expect(enqueued).toEqual([]);
  });

  test("reports an unknown token as missing", async () => {
    const { deps, enqueued } = setup(null);
    expect(await resolveRedirect(deps, "lnk_unknown", "req-1")).toEqual({ kind: "missing" });
    await settle();
    expect(enqueued).toEqual([]);
  });

  test("fails closed when the source is down", async () => {
    const { deps, enqueued } = setup("throw");
    expect(await resolveRedirect(deps, TOKEN, "req-1")).toEqual({ kind: "unavailable" });
    await settle();
    expect(enqueued).toEqual([]);
  });

  test("a throwing error hook does not fail the redirect or leave a rejection unhandled", async () => {
    const { deps, clicks } = setup({ link: link(), eligible: true });
    clicks.failure = new Error("queue down");
    deps.onClickError = () => {
      throw new Error("hook broke");
    };

    const result = await resolveRedirect(deps, TOKEN, "req-1");
    await settle();

    expect(result.kind).toBe("redirect");
  });

  test("still redirects when the queue rejects, and reports the error", async () => {
    const { deps, clicks, errors } = setup({ link: link(), eligible: true });
    clicks.failure = new Error("queue down");

    const result = await resolveRedirect(deps, TOKEN, "req-1");
    await settle();

    expect(result.kind).toBe("redirect");
    expect(errors).toEqual([clicks.failure]);
  });
});
