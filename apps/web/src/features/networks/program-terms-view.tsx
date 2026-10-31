import { Button } from "@moneytrap/ui";
import { type EligibilityDecision, REASON_LABELS, statusText } from "../directory/eligibility-status";
import { Freshness, type LoadState, LoadStateFrame } from "../directory/load-state";

// The approval state as the network reports it. Only the network sets `approved`; a publisher action never does.
export type ApprovalState = "approved" | "pending" | "rejected" | "not_reported";

const APPROVAL_LABELS: Record<ApprovalState, string> = {
  approved: "Approved by the network",
  pending: "Pending network review",
  rejected: "Rejected by the network",
  not_reported: "The network has not reported approval",
};

export type ProgramTermsData = {
  programName: string;
  termsRevision: string;
  terms: string;
  countries: readonly string[];
  channels: readonly string[];
  decision: EligibilityDecision;
  approval: ApprovalState;
  approvalRequested: boolean;
  asOf: string;
  stale: boolean;
};

// SKELETONS §4.2 "Program terms and reasons" (UI-029, UI-030). The reasons are the decision's own text, so they match it.
export function ProgramTermsView({
  state,
  canRequestApproval = false,
  onRequestApproval,
  onRetry,
}: {
  state: LoadState<ProgramTermsData>;
  canRequestApproval?: boolean;
  onRequestApproval?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <section className="max-w-3xl space-y-4">
      <LoadStateFrame state={state} label="program terms" onRetry={onRetry}>
        {(data) => (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-xl font-semibold">{data.programName}</h1>
              <p className="text-sm font-medium">{statusText(data.decision)}</p>
            </div>
            <Freshness asOf={data.asOf} stale={data.stale} />
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="font-medium">Countries</dt>
              <dd>{data.countries.join(", ") || "None listed"}</dd>
              <dt className="font-medium">Channels</dt>
              <dd>{data.channels.join(", ") || "None listed"}</dd>
              <dt className="font-medium">Network approval</dt>
              <dd>{APPROVAL_LABELS[data.approval]}</dd>
            </dl>
            <div className="space-y-1 text-sm">
              <h2 className="font-semibold">Terms (revision {data.termsRevision})</h2>
              <p>{data.terms}</p>
            </div>
            <div className="space-y-1 text-sm">
              <h2 className="font-semibold">Why this decision</h2>
              <ul className="list-disc pl-5">
                {data.decision.decision === "allow" ? (
                  <li>Every eligibility rule passes for this property.</li>
                ) : data.decision.reasons.length > 0 ? (
                  data.decision.reasons.map((reason) => <li key={reason}>{REASON_LABELS[reason]}</li>)
                ) : (
                  <li>The network reported no reason for this decision.</li>
                )}
              </ul>
            </div>
            {data.approvalRequested ? (
              <p className="text-sm">
                Approval requested. Only the network can approve; its decision will appear here.
              </p>
            ) : canRequestApproval && data.decision.decision === "deny" && data.approval !== "approved" ? (
              <Button variant="outline" onClick={() => onRequestApproval?.()}>
                Request approval
              </Button>
            ) : null}
          </>
        )}
      </LoadStateFrame>
    </section>
  );
}
