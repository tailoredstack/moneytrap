// Read-only table of review decisions (UI-077). Rows come from the audit query; the viewer never edits them.
export interface AuditEntry {
  id: string;
  actor: { type: string; id: string | null };
  scope: string | null;
  action: string;
  reason: string | null;
  occurredAt: string;
  object: { type: string; id: string };
}

export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <p>No review decisions recorded.</p>;
  }
  return (
    <table>
      <caption className="sr-only">Review decisions, newest first</caption>
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">Actor</th>
          <th scope="col">Scope</th>
          <th scope="col">Action</th>
          <th scope="col">Reason</th>
          <th scope="col">Object</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id}>
            <td>
              <time dateTime={entry.occurredAt}>{entry.occurredAt}</time>
            </td>
            <td>{entry.actor.id ?? `${entry.actor.type} (no id)`}</td>
            <td>{entry.scope ?? "—"}</td>
            <td>{entry.action}</td>
            <td>{entry.reason ?? "—"}</td>
            <td>{`${entry.object.type}:${entry.object.id}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
