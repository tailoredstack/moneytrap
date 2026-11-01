import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@moneytrap/ui";
import { Freshness, LoadStateFrame } from "../directory/load-state";
import type { ClickReportState } from "./click-report";

// SKELETONS §5.4, UI-037. Counts come per link from WP-5.9, so the table is the primary view and the bars only repeat it.
// Stale data keeps its numbers on screen and gets the freshness notice above them (SKELETONS §10.2).
export function ClickReportView({
  state,
  windowLabel,
  onNext,
  onRetry,
}: {
  state: ClickReportState;
  windowLabel: string;
  onNext?: ((cursor: string) => void) | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <section className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Clicks · {windowLabel}</h1>
      {state.kind === "not_found" ? (
        <p className="text-sm">Page not found.</p>
      ) : (
        <LoadStateFrame state={state} label="clicks" onRetry={onRetry}>
          {(data) => {
            const max = Math.max(0, ...data.rows.map((row) => row.clicks));
            const next = data.nextCursor;
            return (
              <>
                <Freshness asOf={data.asOf} stale={data.stale} />
                {data.rows.length === 0 ? (
                  <p className="text-sm">No clicks in this period yet.</p>
                ) : (
                  <>
                    <Table>
                      <caption className="sr-only">Clicks per link for {windowLabel}</caption>
                      <TableHeader>
                        <TableRow>
                          <TableHead scope="col">Link</TableHead>
                          <TableHead scope="col" className="text-right">
                            Clicks
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.rows.map((row) => (
                          <TableRow key={row.linkId}>
                            <TableCell className="font-mono">{row.linkId}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              <span>{row.clicks.toLocaleString("en-US")}</span>
                              <span
                                aria-hidden="true"
                                className="ml-2 inline-block h-2 rounded bg-foreground/60 align-middle"
                                style={{ width: max === 0 ? 0 : `${Math.round((row.clicks / max) * 96)}px` }}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <p className="text-sm text-muted-foreground">Showing {data.rows.length} links</p>
                  </>
                )}
                {next && onNext ? (
                  <Button variant="outline" size="sm" onClick={() => onNext(next)}>
                    Next
                  </Button>
                ) : null}
              </>
            );
          }}
        </LoadStateFrame>
      )}
    </section>
  );
}
