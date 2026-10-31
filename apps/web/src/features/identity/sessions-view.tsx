import { Button } from "@moneytrap/ui";

// SKELETONS §1.3 "Manage sessions". The session in use is marked and cannot be ended from here, so the user stays signed in.
export type SessionRow = { token: string; createdAt: string; userAgent?: string | undefined; current: boolean };

export function SessionsView({
  sessions,
  error,
  onRevoke,
}: {
  sessions: SessionRow[];
  error?: string | undefined;
  onRevoke?: (token: string) => void;
}) {
  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Sessions</h1>
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {sessions.length === 0 ? <p className="text-sm">No active sessions.</p> : null}
      <ul className="space-y-3">
        {sessions.map((session) => (
          <li key={session.token} className="flex items-center justify-between rounded-md border p-3 text-sm">
            <div>
              <p>{session.userAgent ?? "Unknown device"}</p>
              <time dateTime={session.createdAt} className="text-muted-foreground">
                {session.createdAt}
              </time>
            </div>
            {session.current ? (
              <span className="text-muted-foreground">This session</span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                aria-label={`Revoke ${session.userAgent ?? "unknown device"} session from ${session.createdAt}`}
                onClick={() => onRevoke?.(session.token)}
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
