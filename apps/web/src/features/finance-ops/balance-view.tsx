import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@moneytrap/ui";
import { Freshness, type LoadState, LoadStateFrame } from "../directory/load-state";
import { formatMoney } from "./money";
import { UnavailableNotice } from "./unavailable";

export interface CurrencyBalance {
  currency: string;
  exponent: number;
  // Minor units. Null when the source is stale and cannot vouch for this bucket.
  estimated: bigint | null;
  approved: bigint | null;
  available: bigint | null;
  reserved: bigint | null;
}

export interface BalanceData {
  asOf: string;
  stale: boolean;
  // One entry per currency. Currencies are never summed together.
  currencies: CurrencyBalance[];
}

export type BalanceState = LoadState<BalanceData> | { kind: "unavailable" };

const BUCKETS = [
  { key: "estimated", label: "Estimated (not approved)" },
  { key: "approved", label: "Approved (pending clear)" },
  { key: "available", label: "Available" },
  { key: "reserved", label: "Reserved for payout" },
] as const;

// UI-046, TP-W6-028, TP-W6-035. Each bucket is labelled and carries its currency. A bucket the source cannot vouch for
// shows a dash and says the data is stale, so it is never read as zero.
export function BalanceView({ state }: { state: BalanceState }) {
  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Balances</h1>
      {state.kind === "unavailable" ? (
        <UnavailableNotice label="Balances" />
      ) : (
        <LoadStateFrame state={state} label="balances">
          {(data) =>
            data.currencies.length === 0 ? (
              <p className="text-sm">No balances yet.</p>
            ) : (
              <>
                <Freshness asOf={data.asOf} stale={data.stale} />
                {data.currencies.map((balance) => (
                  <Table key={balance.currency}>
                    <caption className="mb-2 text-left text-sm font-medium">Balances · {balance.currency}</caption>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Bucket</TableHead>
                        <TableHead scope="col" className="text-right">
                          Amount
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {BUCKETS.map((bucket) => {
                        const minor = balance[bucket.key];
                        return (
                          <TableRow key={bucket.key}>
                            <TableCell>{bucket.label}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatMoney(
                                minor === null
                                  ? null
                                  : { minor, currency: balance.currency, exponent: balance.exponent },
                              )}
                              {minor === null ? <span className="ml-2 text-muted-foreground">data stale</span> : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ))}
                <details className="text-sm">
                  <summary className="cursor-pointer">Why is my balance not available?</summary>
                  <p className="mt-2">
                    Estimated funds are not approved yet. Approved funds become available only after they clear for
                    payout.
                  </p>
                </details>
              </>
            )
          }
        </LoadStateFrame>
      )}
    </section>
  );
}
