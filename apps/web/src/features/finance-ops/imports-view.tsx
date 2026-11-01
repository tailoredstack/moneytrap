import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@moneytrap/ui";
import { formatTimestamp, type LoadState, LoadStateFrame } from "../directory/load-state";
import { UnavailableNotice } from "./unavailable";

export interface ImportBatch {
  id: string;
  startedAt: string;
  status: "imported" | "failed" | "running";
  rowCount: number;
  errorCount: number;
  matchedCount: number | null;
  unmatchedCount: number | null;
  // Why the batch failed, in words (e.g. "timeout"). Null when it did not fail.
  failureReason: string | null;
  digest: string;
  parserVersion: string;
}

export type ImportsState = LoadState<ImportBatch[]> | { kind: "unavailable" };

const STATUS_LABEL: Record<ImportBatch["status"], string> = {
  imported: "Imported",
  failed: "Failed",
  running: "Running",
};

// UI-039, TP-W6-036. A failed batch shows its reason in words next to a retry action. The status is text, not colour.
export function ImportsView({
  state,
  onRetry,
}: {
  state: ImportsState;
  onRetry?: ((batchId: string) => void) | undefined;
}) {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Imports</h1>
      {state.kind === "unavailable" ? (
        <UnavailableNotice label="Imports" />
      ) : (
        <LoadStateFrame state={state} label="imports">
          {(batches) =>
            batches.length === 0 ? (
              <p className="text-sm">No imports yet.</p>
            ) : (
              <Table>
                <caption className="sr-only">Upstream report imports</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Batch</TableHead>
                    <TableHead scope="col">Started</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="font-mono">{batch.id}</TableCell>
                      <TableCell>
                        <time dateTime={batch.startedAt}>{formatTimestamp(batch.startedAt)}</time>
                      </TableCell>
                      <TableCell>{STATUS_LABEL[batch.status]}</TableCell>
                      <TableCell className="space-y-1">
                        {batch.status === "failed" ? (
                          <p>{batch.failureReason ?? "Unknown reason"}</p>
                        ) : (
                          <p>
                            {batch.rowCount.toLocaleString("en-US")} rows · {batch.errorCount.toLocaleString("en-US")}{" "}
                            errors
                          </p>
                        )}
                        {batch.matchedCount !== null && batch.unmatchedCount !== null ? (
                          <p>
                            {batch.matchedCount.toLocaleString("en-US")} matched ·{" "}
                            {batch.unmatchedCount.toLocaleString("en-US")} unmatched
                          </p>
                        ) : null}
                        <p className="font-mono text-xs text-muted-foreground">
                          digest {batch.digest} · parser {batch.parserVersion}
                        </p>
                        {batch.status === "failed" && onRetry ? (
                          <Button variant="outline" size="sm" onClick={() => onRetry(batch.id)}>
                            Retry
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          }
        </LoadStateFrame>
      )}
    </section>
  );
}
