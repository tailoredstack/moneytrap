import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Button, Form, Input, Table, Toaster } from "@moneytrap/ui";
import { QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "./app-shell";
import { AppErrorBoundary, ErrorFallback } from "./error-boundary";
import { createAppQueryClient } from "./query-client";
import { createAppRouter, parseOverviewSearch } from "./router";

describe("router", () => {
  test("search params are typed and defaulted", () => {
    expect(parseOverviewSearch({})).toEqual({ page: 1, status: "all" });
    expect(parseOverviewSearch({ page: "3", status: "active" })).toEqual({ page: 3, status: "active" });
    expect(() => parseOverviewSearch({ status: "bogus" })).toThrow();
  });

  test("router exposes the overview route with its search schema", () => {
    const router = createAppRouter();
    expect(router.routesByPath["/overview"]).toBeDefined();
  });
});

describe("query client", () => {
  test("is a QueryClient that does not retry 4xx-style failures by default", () => {
    const client = createAppQueryClient();
    expect(client).toBeInstanceOf(QueryClient);
    expect(client.getDefaultOptions().queries?.retry).toBeFunction();
  });
});

describe("error boundary", () => {
  test("captures render errors into state", () => {
    const error = new Error("boom");
    expect(AppErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });

  test("fallback announces the failure through an alert region", () => {
    const html = renderToStaticMarkup(<ErrorFallback error={new Error("boom")} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Something went wrong");
  });
});

describe("shadcn UI primitives", () => {
  test("Button, Input, Form, Table and Toaster render", () => {
    const html = renderToStaticMarkup(
      <div>
        <Button>Save</Button>
        <Input aria-label="Email" />
        <Form onSubmit={() => {}}>
          <Table>
            <tbody />
          </Table>
        </Form>
        <Toaster />
      </div>,
    );
    expect(html).toContain("<button");
    expect(html).toContain("<input");
    expect(html).toContain("<form");
    expect(html).toContain("<table");
  });
});

describe("app shell", () => {
  test("first focusable element is a skip link to main content", () => {
    const html = renderToStaticMarkup(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );
    expect(html.indexOf('href="#main-content"')).toBeGreaterThan(-1);
    expect(html.indexOf('href="#main-content"')).toBeLessThan(html.indexOf("<main"));
    expect(html).toContain('id="main-content"');
  });
});

describe("boundaries", () => {
  test("web source imports only contracts, ui, and third-party packages", () => {
    const root = join(import.meta.dir, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !name.endsWith(".test.tsx") && !name.endsWith(".test.ts")) files.push(path);
      }
    };
    walk(root);
    const specs = files.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1] as string),
    );
    const forbidden = specs.filter(
      (s) =>
        s.includes("apps/server") ||
        s.includes("adapter-") ||
        s.includes("@moneytrap/domain") ||
        s.includes("@moneytrap/app"),
    );
    expect(forbidden).toEqual([]);
  });
});
