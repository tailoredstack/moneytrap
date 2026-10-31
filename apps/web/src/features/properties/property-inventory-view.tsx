import { PROPERTY_STATUS_LABELS, type PropertyStatus } from "./property-status";

export type PropertyRow = { id: string; domain: string; status: PropertyStatus };

// Icons are decorative. The text label carries the meaning, so the status never relies on colour or the icon alone.
const STATUS_ICONS: Partial<Record<PropertyStatus, string>> = {
  suspended: "⊘",
  rejected: "✕",
  approved: "✓",
};

// SKELETONS §2.3 "Property inventory". Each row has a status label and one action.
export function PropertyInventoryView({ rows, asOf }: { rows: PropertyRow[]; asOf: string }) {
  return (
    <section className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Properties</h1>
        <p className="text-sm text-muted-foreground">
          as of <time dateTime={asOf}>{asOf}</time>
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm">Add your first website to start linking.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th scope="col">Domain</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.domain}</td>
                <td>
                  <span className="inline-flex items-center gap-1">
                    {STATUS_ICONS[row.status] ? (
                      <span aria-hidden="true" data-status-icon={row.status}>
                        {STATUS_ICONS[row.status]}
                      </span>
                    ) : null}
                    {PROPERTY_STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td>{row.status === "verification_pending" ? "Instructions" : "View"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
