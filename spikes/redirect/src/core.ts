export type RouteView = {
  id: string;
  token: string;
  destination: string;
  state: "active" | "revoked";
  eligible: boolean;
  version: number;
};

export interface Store {
  byToken(token: string): Promise<RouteView | null>;
  writeClick(view: RouteView, requestId: string): Promise<void>;
}

export interface Cache {
  view(token: string): Promise<RouteView | null>;
  version(id: string): Promise<number | null>;
  put(view: RouteView): Promise<void>;
}

export type Resolution =
  | { kind: "redirect"; destination: string; click: Promise<void> }
  | { kind: "missing" | "denied" | "unavailable" };

export async function resolveRedirect(
  token: string,
  requestId: string,
  store: Store,
  cache: Cache,
  onClickError: (error: unknown) => void,
): Promise<Resolution> {
  let view: RouteView | null = null;
  try {
    const cached = await cache.view(token);
    if (cached) {
      const version = await cache.version(cached.id);
      if (version === cached.version) view = cached;
    }
  } catch {
    // A cache outage requires a source-of-truth read.
  }

  if (!view) {
    try {
      view = await store.byToken(token);
    } catch {
      return { kind: "unavailable" };
    }
    if (!view) return { kind: "missing" };
    try {
      await cache.put(view);
    } catch {
      // Postgres remains authoritative when Redis is unavailable.
    }
  }

  if (view.state !== "active" || !view.eligible) return { kind: "denied" };
  const click = Promise.resolve().then(() => store.writeClick(view, requestId));
  void click.catch(onClickError);
  return { kind: "redirect", destination: view.destination, click };
}
