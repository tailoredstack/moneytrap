import { runPayoutBatchStoreContract } from "../contracts/payout-batch-store";
import { fixtureId } from "../fixtures/ids";
import { FakePayoutBatchStore } from "./payout-batch-store";

const organizationId = fixtureId("organization", 1);
const otherOrganizationId = fixtureId("organization", 2);
const userId = fixtureId("user", 1);

runPayoutBatchStoreContract([
  {
    name: "fake",
    async open() {
      const store = new FakePayoutBatchStore();
      return {
        store,
        organizationId,
        otherOrganizationId,
        userId,
        async addPublisher(input) {
          store.publisherOrganization.set(input.publisherId, input.organizationId);
          store.publisherStatus.set(input.publisherId, input.status ?? "approved");
          store.addMethod({ id: input.methodId, publisherId: input.publisherId, currency: input.currency });
        },
        async close() {},
      };
    },
  },
]);
