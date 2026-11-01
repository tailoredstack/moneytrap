import { afterEach, describe, expect, test } from "bun:test";
import { ApiError } from "../../api/client";
import { clickWindow, failedState, fetchClickReport, readyState } from "./click-report";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const body = {
  data: [{ link_id: "lnk_1", clicks: 1204 }],
  next_cursor: "lnk_1",
  as_of: "2026-11-01T12:04:00.000Z",
  data_stale: false,
};

// SKELETONS §5.4 and §10.2. TP-W5-036 and TP-W5-037 at the client boundary.
describe("click report client (UI-037, TP-W5-036, TP-W5-037)", () => {
  test("the window is the last seven days, as ISO instants the server accepts", () => {
    expect(clickWindow(new Date("2026-11-01T12:04:00.000Z"))).toEqual({
      from: "2026-10-25T12:04:00.000Z",
      to: "2026-11-01T12:04:00.000Z",
    });
  });

  test("a page is requested for the organization in the path, with the window and cursor", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await fetchClickReport("org_1", {
      from: "2026-10-25T12:04:00.000Z",
      to: "2026-11-01T12:04:00.000Z",
      cursor: "lnk_0",
    });
    expect(urls).toEqual([
      "/api/organizations/org_1/reports/clicks?from=2026-10-25T12%3A04%3A00.000Z&to=2026-11-01T12%3A04%3A00.000Z&cursor=lnk_0",
    ]);
  });

  test("a response maps to ready state with the freshness and next page from the server", () => {
    expect(readyState({ ...body, data_stale: true })).toEqual({
      kind: "ready",
      data: {
        rows: [{ linkId: "lnk_1", clicks: 1204 }],
        asOf: "2026-11-01T12:04:00.000Z",
        stale: true,
        nextCursor: "lnk_1",
      },
    });
  });

  test("a forbidden and a missing organization are different states", () => {
    expect(failedState(new ApiError(403, "FORBIDDEN", "req_1", "no"))).toEqual({ kind: "forbidden" });
    expect(failedState(new ApiError(404, "RESOURCE_NOT_FOUND", "req_2", "no"))).toEqual({ kind: "not_found" });
  });

  test("any other failure is an error with its reference, never a count", () => {
    expect(failedState(new ApiError(503, "INTERNAL", "req_9", "down"))).toEqual({ kind: "error", ref: "req_9" });
    expect(failedState(new TypeError("network"))).toEqual({ kind: "error" });
  });
});
