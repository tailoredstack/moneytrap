import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@moneytrap/ui";
import { Freshness, type LoadState, LoadStateFrame } from "../directory/load-state";
import { formatMoney } from "../finance-ops/money";
import { UnavailableNotice } from "../finance-ops/unavailable";
import { formatPeriod, STATUS_LABEL, type StatementStatus } from "./statements";

export interface StatementLine {
  conversionId: string;
  grossMinor: bigint;
  platformMinor: bigint;
  publisherMinor: bigint;
  adjustmentMinor: bigint;
  receiptHref?: string | undefined;
}

export interface StatementDetail {
  id: string;
  periodStart: string;
  currency: string;
  exponent: number;
  status: StatementStatus;
  asOf: string;
  // The sha256 of the closed content (DM-050). Shown in full so a reader can compare it.
  hash: string;
  lines: StatementLine[];
  nextCursor: string | null;
}

export type StatementDetailState = LoadState<StatementDetail> | { kind: "not_found" } | { kind: "unavailable" };

// UI-053, TP-W6-034. The header names the period, status and hash. Line items come one page at a time.
export function StatementDetailView({
  state,
  onNext,
}: {
  state: StatementDetailState;
  onNext?: ((cursor: string) => void) | undefined;
}) {
  return (
    <section className="space-y-4">
      {state.kind === "unavailable" ? (
        <UnavailableNotice label="Statement detail" />
      ) : state.kind === "not_found" ? (
        <p className="text-sm">Page not found.</p>
      ) : (
        <LoadStateFrame state={state} label="statement">
          {(statement) => {
            const money = (minor: bigint) =>
              formatMoney({ minor, currency: statement.currency, exponent: statement.exponent });
            return (
              <>
                <h1 className="text-xl font-semibold">
                  Statement {formatPeriod(statement.periodStart)} · {STATUS_LABEL[statement.status]}
                </h1>
                <Freshness asOf={statement.asOf} stale={false} />
                <p className="text-sm">
                  Currency {statement.currency} · Hash{" "}
                  <code className="break-all font-mono text-xs">{statement.hash}</code>
                </p>
                <Table>
                  <caption className="sr-only">Line items</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Conversion</TableHead>
                      <TableHead scope="col" className="text-right">
                        Gross
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        Platform
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        Publisher
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        Adjustments
                      </TableHead>
                      <TableHead scope="col">Receipt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statement.lines.map((line) => (
                      <TableRow key={line.conversionId}>
                        <TableCell className="font-mono">{line.conversionId}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(line.grossMinor)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(line.platformMinor)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(line.publisherMinor)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(line.adjustmentMinor)}</TableCell>
                        <TableCell>
                          {line.receiptHref ? (
                            <a className="underline" href={line.receiptHref}>
                              Receipt
                            </a>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {statement.nextCursor && onNext ? (
                  <Button variant="outline" size="sm" onClick={() => onNext(statement.nextCursor as string)}>
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
