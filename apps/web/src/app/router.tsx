import { Toaster } from "@moneytrap/ui";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from "@tanstack/react-router";
import { AppShell } from "./app-shell";

const overviewStatuses = ["all", "active", "paused"] as const;
export type OverviewStatus = (typeof overviewStatuses)[number];
export type OverviewSearch = { page: number; status: OverviewStatus };

// Search params come from the URL as strings. Parse them once here so route code gets typed values.
export function parseOverviewSearch(input: Record<string, unknown>): OverviewSearch {
  const page = input.page === undefined ? 1 : Number(input.page);
  if (!Number.isInteger(page) || page < 1) throw new Error("page must be a positive integer");
  const status = input.status === undefined ? "all" : input.status;
  if (!overviewStatuses.includes(status as OverviewStatus)) throw new Error("unknown status");
  return { page, status: status as OverviewStatus };
}

const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
      <Toaster />
    </AppShell>
  ),
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/overview",
  validateSearch: parseOverviewSearch,
  component: function Overview() {
    const search = overviewRoute.useSearch();
    return (
      <h1 className="text-xl font-semibold">
        Overview (page {search.page}, {search.status})
      </h1>
    );
  },
});

const routeTree = rootRoute.addChildren([overviewRoute]);

// Pass a browser history from the entry point. Memory history keeps tests and SSR-free imports safe.
export function createAppRouter(history: RouterHistory = createMemoryHistory({ initialEntries: ["/overview"] })) {
  return createRouter({ routeTree, history });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
