import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { clickWindow, failedState, fetchClickReport, readyState } from "./click-report";
import { ClickReportView } from "./click-report-view";

// Owns the query for the click analytics screen. The window is fixed when the screen mounts, so every page of a cursor
// walk counts the same period. Each page is keyed by its cursor, so a page already loaded is not fetched again.
export function ClickReportScreen({
  organizationId,
  cursor,
  onNext,
}: {
  organizationId: string;
  cursor?: string | undefined;
  onNext?: ((cursor: string) => void) | undefined;
}) {
  const [period] = useState(() => clickWindow(new Date()));
  const query = useQuery({
    queryKey: ["click-report", organizationId, period.from, period.to, cursor ?? null],
    queryFn: () => fetchClickReport(organizationId, { ...period, cursor }),
  });
  const state = query.isPending
    ? { kind: "loading" as const }
    : query.isError
      ? failedState(query.error)
      : readyState(query.data);
  return (
    <ClickReportView state={state} windowLabel="Last 7 days" onNext={onNext} onRetry={() => void query.refetch()} />
  );
}
