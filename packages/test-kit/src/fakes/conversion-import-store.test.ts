import { runConversionImportContract } from "../contracts/conversion-import-store";
import { FakeConversionImportStore } from "./conversion-import-store";

runConversionImportContract([
  {
    name: "fake",
    async open() {
      return { store: new FakeConversionImportStore(), async close() {} };
    },
  },
]);
