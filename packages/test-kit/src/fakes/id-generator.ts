import type { IdGenerator } from "@moneytrap/app/src/ports/id-generator";
import type { Id, IdKind } from "@moneytrap/domain";
import { fixtureId } from "../fixtures/ids";

export class FakeIdGenerator implements IdGenerator {
  private readonly counters = new Map<IdKind, number>();

  next<K extends IdKind>(kind: K): Id<K> {
    const sequence = (this.counters.get(kind) ?? 0) + 1;
    const id = fixtureId(kind, sequence);
    this.counters.set(kind, sequence);
    return id;
  }
}
