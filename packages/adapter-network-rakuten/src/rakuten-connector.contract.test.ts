import { FakeClock, runNetworkConnectorContract } from "@moneytrap/test-kit";
import { createFakeRakuten, FAKE_ACCOUNT_ID, FAKE_CLIENT_ID, FAKE_CLIENT_SECRET } from "./fake-rakuten";
import { RakutenConnector } from "./rakuten-connector";

const NOW = "2026-11-01T00:00:00.000Z";

// WP-4.3: the Rakuten adapter runs the same suite as the recorded-fixture simulator, against a fake upstream that
// follows Rakuten's published API specification.
runNetworkConnectorContract([
  {
    name: "Rakuten Advertising adapter",
    data: {
      advertiserWithPrograms: "100",
      approvedProgramSourceId: "100",
      unapprovedProgramSourceId: "200",
      populatedRange: { from: new Date("2026-10-15T00:00:00.000Z"), to: new Date("2026-11-01T00:00:00.000Z") },
      emptyRange: { from: new Date("2026-10-01T00:00:00.000Z"), to: new Date("2026-10-02T00:00:00.000Z") },
    },
    create: (scenario) => {
      const clock = new FakeClock(NOW);
      const upstream = createFakeRakuten({ mode: scenario, now: () => clock.now(), pageSize: 2 });
      const connector = new RakutenConnector({
        clientId: FAKE_CLIENT_ID,
        clientSecret: FAKE_CLIENT_SECRET,
        accountId: FAKE_ACCOUNT_ID,
        clock,
        fetch: upstream.fetch,
        pageSize: 2,
      });
      return { connector, secrets: [FAKE_CLIENT_ID, FAKE_CLIENT_SECRET] };
    },
  },
]);
