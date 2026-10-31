import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { CommandResultSchema } from "./envelope";
import { ErrorEnvelopeSchema } from "./error";
import { MoneySchema } from "./money";
import { pageSchema } from "./pagination";

describe("OpenAPI generation", () => {
  test("shared schemas serialize into components with their constraints intact", () => {
    const components = {
      schemas: {
        Money: MoneySchema,
        CommandResult: CommandResultSchema,
        Error: ErrorEnvelopeSchema,
        Page: pageSchema(Type.Object({ id: Type.String() })),
      },
    };
    const roundTripped = JSON.parse(JSON.stringify(components));
    expect(roundTripped.schemas.Money.properties.amount.pattern).toBeString();
    expect(roundTripped.schemas.Error.properties.error.properties.code.anyOf).toHaveLength(15);
    expect(roundTripped.schemas.Page.properties.meta.properties.next_cursor.anyOf).toHaveLength(2);
  });
});
