// Operations an affiliate network connector may offer (spec §6.1). A connector advertises which of them it supports
// and never claims universal parity, so each operation carries a capability state.
export const CONNECTOR_OPERATIONS = [
  "validate_connection",
  "discover_advertisers",
  "discover_programs",
  "resolve_tracking_destination",
  "list_transactions",
  "list_adjustments",
  "retrieve_settlement_evidence",
  "receive_notifications",
] as const;

export type ConnectorOperation = (typeof CONNECTOR_OPERATIONS)[number];

// `supported` is the only state that lets a feature run. The other three say why it cannot: the network does not offer
// it, the upstream is down for now (retry with backoff, never read as empty), or the credential may not use it.
export const CAPABILITY_STATES = ["supported", "unsupported", "temporarily_unavailable", "not_authorized"] as const;

export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export type CapabilityProfile = Readonly<Record<ConnectorOperation, CapabilityState>>;

export type UnavailableCapability = { operation: ConnectorOperation; state: Exclude<CapabilityState, "supported"> };

export function isOperationAvailable(profile: CapabilityProfile, operation: ConnectorOperation): boolean {
  return profile[operation] === "supported";
}

// Lists every operation that is not supported, in contract order, so a dependent feature can show why it is unavailable.
export function unavailableOperations(profile: CapabilityProfile): UnavailableCapability[] {
  return CONNECTOR_OPERATIONS.flatMap((operation) => {
    const state = profile[operation];
    return state === "supported" ? [] : [{ operation, state }];
  });
}
