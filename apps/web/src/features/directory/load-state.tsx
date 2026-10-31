import { Button } from "@moneytrap/ui";
import type { ReactNode } from "react";

// The load states every directory and network screen renders (SKELETONS §10.2). Stale is not a load state: the numbers
// stay on screen and the freshness notice sits above them.
export type LoadState<T> =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; ref?: string | undefined }
  | { kind: "ready"; data: T };

// Each screen shows its own content through this frame, so the loading, forbidden and error copy reads the same everywhere.
export function LoadStateFrame<T>({
  state,
  label,
  onRetry,
  children,
}: {
  state: LoadState<T>;
  label: string;
  onRetry?: (() => void) | undefined;
  children: (data: T) => ReactNode;
}) {
  if (state.kind === "loading")
    return (
      <p role="status" className="text-sm">
        Loading {label}…
      </p>
    );
  if (state.kind === "forbidden") {
    return <p className="text-sm">You don't have access to this. Ask an organization owner.</p>;
  }
  if (state.kind === "error") {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>We couldn't load {label}.</p>
        {state.ref ? <p className="text-muted-foreground">Ref: {state.ref}</p> : null}
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={() => onRetry()}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  return <>{children(state.data)}</>;
}

// The machine value stays in `dateTime`; the visible copy is readable, e.g. "2026-10-31 12:04 UTC".
// The instant is converted to UTC first, so an offset such as +02:00 is shown as the UTC time it names.
export function formatTimestamp(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return iso;
  return `${instant.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// Stale data is labelled in words, never by colour. The numbers beside it stay visible.
export function Freshness({ asOf, stale }: { asOf: string; stale: boolean }) {
  return stale ? (
    <p className="text-sm">
      Data stale · last update <time dateTime={asOf}>{formatTimestamp(asOf)}</time>
    </p>
  ) : (
    <p className="text-sm text-muted-foreground">
      as of <time dateTime={asOf}>{formatTimestamp(asOf)}</time>
    </p>
  );
}
