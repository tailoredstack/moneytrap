import { type Static, Type } from "@sinclair/typebox";

// §7.1: the canonical result of a command. Shape is illustrative in the spec; these fields are required.
export const CommandResultSchema = Type.Object(
  {
    operation_id: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    result: Type.Record(Type.String(), Type.Unknown()),
    correlation_id: Type.String({ minLength: 1 }),
    as_of: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$" }),
  },
  { $id: "CommandResult" },
);

export type CommandResult = Static<typeof CommandResultSchema>;
