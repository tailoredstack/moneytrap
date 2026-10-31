import { Button } from "@moneytrap/ui";
import { isMonetizable, PROPERTY_STATUS_LABELS, type PropertyStatus } from "./property-status";

// A verified property is not monetizable until approved, and a rejected one never is (TP-W3-016, TP-W3-017).
function monetizableCopy(status: PropertyStatus): string {
  if (isMonetizable(status)) return "Monetizable: Yes.";
  if (status === "rejected") return "Monetizable: No: rejected.";
  return "Monetizable: No: approval pending.";
}

// SKELETONS §2.4 "Property details". The submit action needs a verified property and a fresh page.
// When another tab changed the status, the page asks for a refresh and blocks submit, so no change is overwritten silently.
export function PropertyDetailsView({
  domain,
  status,
  asOf,
  stale = false,
  changedElsewhere = false,
  onRefresh,
  onSubmit,
}: {
  domain: string;
  status: PropertyStatus;
  asOf: string;
  stale?: boolean | undefined;
  changedElsewhere?: boolean | undefined;
  onRefresh?: (() => void) | undefined;
  onSubmit?: (() => void) | undefined;
}) {
  // A change made in another tab blocks submit until the user refreshes, even when the page is not otherwise stale.
  const canSubmit = status === "verified" && !stale && !changedElsewhere;
  return (
    <section className="max-w-2xl space-y-4 text-sm">
      <h1 className="text-xl font-semibold">{domain}</h1>
      <p>
        <span>( {PROPERTY_STATUS_LABELS[status]} )</span> as of <time dateTime={asOf}>{asOf}</time>
        {stale ? <span> · data stale</span> : null}
      </p>
      {changedElsewhere ? (
        <div role="status" className="flex items-center justify-between gap-2 rounded-md border p-3">
          <p>This property changed in another tab. Refresh to see the latest status.</p>
          <Button variant="outline" size="sm" onClick={() => onRefresh?.()}>
            Refresh
          </Button>
        </div>
      ) : null}
      <p>{monetizableCopy(status)}</p>
      <p>Links: 0 active</p>
      <Button disabled={!canSubmit} onClick={() => onSubmit?.()}>
        Submit for review
      </Button>
    </section>
  );
}
