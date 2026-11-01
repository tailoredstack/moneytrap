import { CONNECTOR_OPERATIONS } from "@moneytrap/domain";
import { type ConnectorContractScenario, runNetworkConnectorContract } from "../contracts/network-connector";
import { RECORDED_FIXTURES, type RecordedFixture } from "./fixtures";
import { RecordedNetworkSimulator } from "./simulator";

const clean = RECORDED_FIXTURES["clean-catalog"];

// Every operation except validate_connection (which is exempt from the profile) cannot answer.
const unavailable: RecordedFixture = {
  ...clean,
  capabilities: Object.fromEntries(
    CONNECTOR_OPERATIONS.map((operation) => [
      operation,
      operation === "validate_connection" ? "supported" : "temporarily_unavailable",
    ]),
  ) as RecordedFixture["capabilities"],
};

const fixtureFor: Record<ConnectorContractScenario, RecordedFixture> = {
  healthy: clean,
  "disabled-credential": RECORDED_FIXTURES["disabled-credential"],
  "upstream-unavailable": unavailable,
};

// WP-4.3: the simulator and the real adapter run the same suite.
runNetworkConnectorContract([
  {
    name: "recorded-fixture simulator",
    data: {
      advertiserWithPrograms: "adv-100",
      approvedProgramSourceId: "prg-1",
      unapprovedProgramSourceId: "prg-2",
      populatedRange: { from: new Date("2026-10-01T00:00:00.000Z"), to: new Date("2026-11-01T00:00:00.000Z") },
      emptyRange: { from: new Date("2026-10-01T00:00:00.000Z"), to: new Date("2026-10-02T00:00:00.000Z") },
    },
    create: (scenario) => ({ connector: new RecordedNetworkSimulator(fixtureFor[scenario]), secrets: [] }),
  },
]);
