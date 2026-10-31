import { ROUTE_GUARDS } from "./routes";

// The build check (Blueprint §7): every served route must have a guard entry. Returns the `METHOD /path` keys
// that have none, so the failing test can name them.
export function undeclaredRoutes(
  routes: ReadonlyArray<{ method: string; path: string }>,
  table: Readonly<Record<string, unknown>> = ROUTE_GUARDS,
): string[] {
  return routes.map((route) => `${route.method} ${route.path}`).filter((key) => !(key in table));
}
