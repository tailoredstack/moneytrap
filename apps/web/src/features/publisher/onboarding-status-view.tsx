import { PUBLISHER_STATUS_LABELS, type PublisherStatus } from "./publisher-status";

// SKELETONS §2.1 "Publisher onboarding status". Each step shows its state as text. Properties stay locked until approval.
export function OnboardingStatusView({
  status,
  asOf,
  stale = false,
  rejectionReason,
}: {
  status: PublisherStatus;
  asOf: string;
  stale?: boolean | undefined;
  rejectionReason?: string | undefined;
}) {
  const approved = status === "approved";
  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Your publisher account</h1>
      <p className="text-sm text-muted-foreground">
        <span>( {PUBLISHER_STATUS_LABELS[status]} )</span> as of <time dateTime={asOf}>{asOf}</time>
        {stale ? <span> · data stale</span> : null}
      </p>
      <ol className="space-y-2 text-sm">
        <li>Step 1 Account: done</li>
        <li>Step 2 Business (KYB): {status === "draft" ? "start" : PUBLISHER_STATUS_LABELS[status]}</li>
        <li>Step 3 Properties: {approved ? "unlocked" : "locked until approval"}</li>
        <li>
          Step 4 Review:{" "}
          {status === "in_review" ? "in review, typical 2 business days" : PUBLISHER_STATUS_LABELS[status]}
        </li>
      </ol>
      {status === "rejected" && rejectionReason ? (
        <p className="text-sm">
          <span className="font-medium">Reason:</span> {rejectionReason}
        </p>
      ) : null}
    </section>
  );
}
