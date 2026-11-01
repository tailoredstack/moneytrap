import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@moneytrap/ui";
import { useState } from "react";
import { type LoadState, LoadStateFrame } from "../directory/load-state";
import {
  type ExceptionFilter,
  type ExceptionRow,
  filterExceptions,
  NO_EXCEPTION_FILTER,
  pageOf,
  REASON_LABEL,
  STATUS_LABEL,
} from "./exceptions";
import { formatMoney } from "./money";
import { UnavailableNotice } from "./unavailable";

export type ExceptionsState = LoadState<ExceptionRow[]> | { kind: "unavailable" };

// UI-040, TP-W6-033. The filters and the page live in this view, so a long queue never renders in full. A filter change
// goes back to page one.
export function ExceptionsView({
  state,
  onInvestigate,
}: {
  state: ExceptionsState;
  onInvestigate?: ((conversionId: string) => void) | undefined;
}) {
  const [filter, setFilter] = useState<ExceptionFilter>(NO_EXCEPTION_FILTER);
  const [requestedPage, setRequestedPage] = useState(1);

  const changeFilter = (next: ExceptionFilter) => {
    setFilter(next);
    setRequestedPage(1);
  };

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Exceptions</h1>
      {state.kind === "unavailable" ? (
        <UnavailableNotice label="Exceptions" />
      ) : (
        <LoadStateFrame state={state} label="exceptions">
          {(rows) => {
            if (rows.length === 0) return <p className="text-sm">No exceptions yet.</p>;
            const matching = filterExceptions(rows, filter);
            const page = pageOf(matching, requestedPage);
            return (
              <>
                <div className="flex flex-wrap gap-4">
                  <label className="space-y-1 text-sm" htmlFor="exceptions-reason">
                    <span className="block">Reason</span>
                    <select
                      id="exceptions-reason"
                      className="h-9 rounded-md border bg-background px-2"
                      value={filter.reason}
                      onChange={(event) =>
                        changeFilter({ ...filter, reason: event.currentTarget.value as ExceptionFilter["reason"] })
                      }
                    >
                      <option value="all">All reasons</option>
                      {Object.entries(REASON_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm" htmlFor="exceptions-status">
                    <span className="block">Status</span>
                    <select
                      id="exceptions-status"
                      className="h-9 rounded-md border bg-background px-2"
                      value={filter.status}
                      onChange={(event) =>
                        changeFilter({ ...filter, status: event.currentTarget.value as ExceptionFilter["status"] })
                      }
                    >
                      <option value="all">All statuses</option>
                      {Object.entries(STATUS_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {page.total === 0 ? (
                  <p className="text-sm">No exceptions match these filters.</p>
                ) : (
                  <>
                    <Table>
                      <caption className="sr-only">Conversion exceptions</caption>
                      <TableHeader>
                        <TableRow>
                          <TableHead scope="col">Conversion</TableHead>
                          <TableHead scope="col">Reason</TableHead>
                          <TableHead scope="col" className="text-right">
                            Amount
                          </TableHead>
                          {onInvestigate ? <TableHead scope="col">Action</TableHead> : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {page.rows.map((row) => (
                          <TableRow key={row.conversionId}>
                            <TableCell className="font-mono">{row.conversionId}</TableCell>
                            <TableCell>{REASON_LABEL[row.reason]}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatMoney(row.amount)}</TableCell>
                            {onInvestigate ? (
                              <TableCell>
                                <Button variant="outline" size="sm" onClick={() => onInvestigate(row.conversionId)}>
                                  Investigate
                                </Button>
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-muted-foreground">
                        Showing {page.from}–{page.to} of {page.total}
                      </span>
                      {page.hasPrevious ? (
                        <Button variant="outline" size="sm" onClick={() => setRequestedPage(page.page - 1)}>
                          Previous
                        </Button>
                      ) : null}
                      {page.hasNext ? (
                        <Button variant="outline" size="sm" onClick={() => setRequestedPage(page.page + 1)}>
                          Next
                        </Button>
                      ) : null}
                    </div>
                  </>
                )}
              </>
            );
          }}
        </LoadStateFrame>
      )}
    </section>
  );
}
