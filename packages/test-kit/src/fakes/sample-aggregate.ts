import type { SampleAggregate, SampleAggregateStore } from "../contracts/aggregate-store";

/** In-memory reference adapter for the sample aggregate contract. */
export class FakeSampleAggregateStore implements SampleAggregateStore {
  private readonly aggregates = new Map<string, SampleAggregate>();

  async create(aggregate: SampleAggregate): Promise<void> {
    if (this.aggregates.has(aggregate.id)) throw new Error("duplicate aggregate id");
    this.aggregates.set(aggregate.id, { ...aggregate });
  }

  async get(id: string): Promise<SampleAggregate | null> {
    const aggregate = this.aggregates.get(id);
    return aggregate ? { ...aggregate } : null;
  }

  async update(aggregate: SampleAggregate): Promise<boolean> {
    if (!this.aggregates.has(aggregate.id)) return false;
    this.aggregates.set(aggregate.id, { ...aggregate });
    return true;
  }
}
