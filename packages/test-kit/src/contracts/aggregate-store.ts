import { describe, expect, test } from "bun:test";

/** Small aggregate used to prove that a fake and a database adapter share one contract. */
export type SampleAggregate = { id: string; value: number };

export interface SampleAggregateStore {
  create(aggregate: SampleAggregate): Promise<void>;
  get(id: string): Promise<SampleAggregate | null>;
  update(aggregate: SampleAggregate): Promise<boolean>;
}

export type AggregateStoreFixture = {
  store: SampleAggregateStore;
  close(): Promise<void>;
};

export function runSampleAggregateContract(
  adapters: ReadonlyArray<{
    name: string;
    open(): Promise<AggregateStoreFixture>;
  }>,
): void {
  describe.each(adapters)("TP-W1-033 $name aggregate store contract", ({ open }) => {
    async function withStore(check: (store: SampleAggregateStore) => Promise<void>): Promise<void> {
      const fixture = await open();
      try {
        await check(fixture.store);
      } finally {
        await fixture.close();
      }
    }

    test("missing aggregate returns null", () =>
      withStore(async (store) => {
        expect(await store.get("missing")).toBeNull();
      }));

    test("create and get preserve the aggregate", () =>
      withStore(async (store) => {
        await store.create({ id: "sample", value: 7 });
        expect(await store.get("sample")).toEqual({ id: "sample", value: 7 });
      }));

    test("duplicate identity is rejected without replacing the original", () =>
      withStore(async (store) => {
        await store.create({ id: "sample", value: 7 });
        await expect(store.create({ id: "sample", value: 9 })).rejects.toThrow();
        expect(await store.get("sample")).toEqual({ id: "sample", value: 7 });
      }));

    test("update changes an existing aggregate and reports a missing one", () =>
      withStore(async (store) => {
        expect(await store.update({ id: "missing", value: 1 })).toBe(false);
        await store.create({ id: "sample", value: 7 });
        expect(await store.update({ id: "sample", value: 11 })).toBe(true);
        expect(await store.get("sample")).toEqual({ id: "sample", value: 11 });
      }));

    test("returned values cannot mutate stored state", () =>
      withStore(async (store) => {
        await store.create({ id: "sample", value: 7 });
        const found = await store.get("sample");
        if (!found) throw new Error("aggregate was not found");
        found.value = 99;
        expect(await store.get("sample")).toEqual({ id: "sample", value: 7 });
      }));
  });
}
