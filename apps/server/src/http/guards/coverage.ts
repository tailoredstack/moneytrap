import { GUARD_KEY } from "./enforce";
import { ROUTE_GUARDS } from "./routes";

// The build check (Blueprint §7): every served route must have a table entry and must have that entry's guard
// installed. Returns the `METHOD /path` keys that fail either test, so the failing test can name them.
export function undeclaredRoutes(
  routes: ReadonlyArray<{ method: string; path: string; hooks?: unknown }>,
  table: Readonly<Record<string, unknown>> = ROUTE_GUARDS,
): string[] {
  return routes
    .filter((route) => {
      const key = `${route.method} ${route.path}`;
      return !(key in table) || !installsGuard(route, key);
    })
    .map((route) => `${route.method} ${route.path}`);
}

// Elysia keeps a route's beforeHandle hooks as one function or an array. The route is guarded only when one of
// them is a guard hook built for this same key.
function installsGuard(route: { hooks?: unknown }, key: string): boolean {
  const beforeHandle = (route.hooks as { beforeHandle?: unknown } | undefined)?.beforeHandle;
  const hooks = Array.isArray(beforeHandle) ? beforeHandle : [beforeHandle];
  return hooks.some(
    (hook) => typeof hook === "function" && (hook as unknown as Record<symbol, unknown>)[GUARD_KEY] === key,
  );
}
