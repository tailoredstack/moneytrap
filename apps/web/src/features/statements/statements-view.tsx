import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@moneytrap/ui";
import { useState } from "react";
import { type LoadState, LoadStateFrame } from "../directory/load-state";
import { formatMoney } from "../finance-ops/money";
import { UnavailableNotice } from "../finance-ops/unavailable";
import {
  filterStatements,
  formatPeriod,
  NO_STATEMENT_FILTER,
  periodKey,
  STATUS_LABEL,
  type StatementFilter,
  type StatementRow,
} from "./statements";

export type StatementsState = LoadState<StatementRow[]> | { kind: "unavailable" };

// UI-043, SKELETONS §6.2. The period and currency options come from the statements the publisher has, so a filter
// never offers an empty choice. View and Download appear only when the parent gives a handler.
export function StatementsView({
  state,
  onView,
  onDownload,
}: {
  state: StatementsState;
  onView?: ((id: string) => void) | undefined;
  onDownload?: ((id: string) => void) | undefined;
}) {
  const [filter, setFilter] = useState<StatementFilter>(NO_STATEMENT_FILTER);

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Statements</h1>
      {state.kind === "unavailable" ? (
        <UnavailableNotice label="Statements" />
      ) : (
        <LoadStateFrame state={state} label="statements">
          {(rows) => {
            if (rows.length === 0) return <p className="text-sm">No statements yet.</p>;
            const periods = [...new Set(rows.map((row) => row.periodStart))]
              .map((periodStart) => ({ key: periodKey(periodStart), label: formatPeriod(periodStart) }))
              .filter((option, index, all) => all.findIndex((other) => other.key === option.key) === index)
              .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
            const currencies = [...new Set(rows.map((row) => row.currency))].sort();
            const matching = filterStatements(rows, filter);
            return (
              <>
                <div className="flex flex-wrap gap-4">
                  <label className="space-y-1 text-sm" htmlFor="statements-period">
                    <span className="block">Period</span>
                    <select
                      id="statements-period"
                      className="h-9 rounded-md border bg-background px-2"
                      value={filter.period}
                      onChange={(event) => setFilter({ ...filter, period: event.currentTarget.value })}
                    >
                      <option value="all">All periods</option>
                      {periods.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm" htmlFor="statements-currency">
                    <span className="block">Currency</span>
                    <select
                      id="statements-currency"
                      className="h-9 rounded-md border bg-background px-2"
                      value={filter.currency}
                      onChange={(event) => setFilter({ ...filter, currency: event.currentTarget.value })}
                    >
                      <option value="all">All currencies</option>
                      {currencies.map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {matching.length === 0 ? (
                  <p className="text-sm">No statements match these filters.</p>
                ) : (
                  <Table>
                    <caption className="sr-only">Statements by period</caption>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Period</TableHead>
                        <TableHead scope="col" className="text-right">
                          Total
                        </TableHead>
                        <TableHead scope="col">Status</TableHead>
                        {onView || onDownload ? <TableHead scope="col">Action</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {matching.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{formatPeriod(row.periodStart)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(row.total)}</TableCell>
                          <TableCell>{STATUS_LABEL[row.status]}</TableCell>
                          {onView || onDownload ? (
                            <TableCell className="space-x-2">
                              {onView ? (
                                <Button variant="outline" size="sm" onClick={() => onView(row.id)}>
                                  View
                                </Button>
                              ) : null}
                              {onDownload ? (
                                <Button variant="outline" size="sm" onClick={() => onDownload(row.id)}>
                                  Download
                                </Button>
                              ) : null}
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            );
          }}
        </LoadStateFrame>
      )}
    </section>
  );
}
