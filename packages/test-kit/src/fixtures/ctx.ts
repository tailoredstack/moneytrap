import type { Ctx } from "@moneytrap/app/src/ctx";
import { FakeClock } from "../clock";
import { FakeIdGenerator } from "../fakes/id-generator";

/** Build an action context with fresh fakes while retaining the caller's real or test database. */
export function fixtureCtx<DB>(db: Ctx<DB>["db"], overrides: Partial<Omit<Ctx<DB>, "db">> = {}): Ctx<DB> {
  return {
    db,
    clock: overrides.clock ?? new FakeClock(),
    ids: overrides.ids ?? new FakeIdGenerator(),
    actor: overrides.actor ?? { type: "system", id: null },
  };
}
