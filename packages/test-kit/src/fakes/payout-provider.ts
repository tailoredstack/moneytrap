import { PayoutProviderSimulator } from "../payout-sim/simulator";

/** Reference fake for the payout provider port: the simulator in its happy scenario. */
export class FakePayoutProvider extends PayoutProviderSimulator {
  constructor() {
    super("happy");
  }
}
