import { Button } from "@moneytrap/ui";
import { Freshness, formatTimestamp, type LoadState, LoadStateFrame } from "../directory/load-state";

// The network connector's answer per operation (spec §6.1). Only `supported` lets a feature run.
export type CapabilityState = "supported" | "unsupported" | "temporarily_unavailable" | "not_authorized";

export type ConnectorHealth = "available" | "temporarily_unavailable" | "not_authorized";

export type NetworkStatusData = {
  networkName: string;
  health: ConnectorHealth;
  lastSuccessfulSync: string | null;
  asOf: string;
  catalogStale: boolean;
  capabilities: { transactions: CapabilityState; adjustments: CapabilityState };
  credential: { configured: boolean; lastRotated: string | null };
};

const HEALTH_LABELS: Record<ConnectorHealth, string> = {
  available: "Available",
  temporarily_unavailable: "Temporarily unavailable",
  not_authorized: "Credential not authorized",
};

// A pause is explained, never shown as an error and never read as an empty result (TP-W4-029).
const HEALTH_EXPLANATIONS: Record<ConnectorHealth, string | null> = {
  available: null,
  temporarily_unavailable:
    "The network did not answer. Sync retries automatically. The figures shown are from the last successful sync.",
  not_authorized: "The network rejected this credential. An operations administrator must rotate it.",
};

const CAPABILITY_LABELS: Record<CapabilityState, string> = {
  supported: "Supported",
  unsupported: "Not offered by this network",
  temporarily_unavailable: "Temporarily unavailable",
  not_authorized: "Not authorized",
};

const CAPABILITY_ICONS: Partial<Record<CapabilityState, string>> = { supported: "✓", unsupported: "✗" };

const CAPABILITY_NAMES = { transactions: "Transactions", adjustments: "Adjustments" } as const;

// SKELETONS §4.3 "Network status" (UI-026, UI-076). Operations-only controls and the credential panel are gated by `ops`,
// which is a UX choice. The server decides what the caller may read.
export function NetworkStatusView({
  state,
  ops = false,
  onRetrySync,
  onRetry,
}: {
  state: LoadState<NetworkStatusData>;
  ops?: boolean;
  onRetrySync?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <section className="max-w-3xl space-y-4">
      <LoadStateFrame state={state} label="network status" onRetry={onRetry}>
        {(data) => (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-xl font-semibold">Network: {data.networkName}</h1>
              <p role="status" className="text-sm font-medium">
                {HEALTH_LABELS[data.health]}
              </p>
            </div>
            {HEALTH_EXPLANATIONS[data.health] ? <p className="text-sm">{HEALTH_EXPLANATIONS[data.health]}</p> : null}
            <p className="text-sm">
              Last successful sync:{" "}
              {data.lastSuccessfulSync ? (
                <time dateTime={data.lastSuccessfulSync}>{formatTimestamp(data.lastSuccessfulSync)}</time>
              ) : (
                "none yet"
              )}
            </p>
            <Freshness asOf={data.asOf} stale={data.catalogStale} />
            <p className="text-sm">Catalog data: {data.catalogStale ? "stale" : "current"}</p>
            <div>
              <h2 className="text-sm font-semibold">Capabilities</h2>
              <ul className="text-sm">
                {(Object.keys(CAPABILITY_NAMES) as (keyof typeof CAPABILITY_NAMES)[]).map((key) => {
                  const capability = data.capabilities[key];
                  return (
                    <li key={key}>
                      {CAPABILITY_NAMES[key]}:{" "}
                      <span>
                        {CAPABILITY_ICONS[capability] ? (
                          <span aria-hidden="true">{CAPABILITY_ICONS[capability]}</span>
                        ) : null}{" "}
                        {CAPABILITY_LABELS[capability]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            {ops ? (
              <div className="space-y-3 border-t pt-4">
                <p className="text-sm">
                  Credential:{" "}
                  {data.credential.configured ? (
                    <>
                      <span aria-hidden="true">✓</span> configured
                    </>
                  ) : (
                    "not configured"
                  )}
                  {data.credential.lastRotated ? (
                    <>
                      {" "}
                      · last rotated{" "}
                      <time dateTime={data.credential.lastRotated}>{formatTimestamp(data.credential.lastRotated)}</time>
                    </>
                  ) : null}
                </p>
                <Button variant="outline" onClick={() => onRetrySync?.()}>
                  Retry sync
                </Button>
              </div>
            ) : null}
          </>
        )}
      </LoadStateFrame>
    </section>
  );
}
