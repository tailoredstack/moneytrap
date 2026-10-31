import type { CurrencyCode } from "../money/iso4217";
import { Money } from "../money/money";
import type { ShareRule } from "./share-rule";

export type Allocation = {
  readonly publisher: Money;
  readonly platform: Money;
  readonly other: Money;
  readonly roundingVersion: number;
  readonly currency: CurrencyCode;
};

export function allocate(recognized: Money, rule: ShareRule): Allocation {
  if (recognized.amount < 0n) {
    throw new Error("recognized amount must be non-negative");
  }
  const total = recognized.amount;
  const bps = [rule.publisherBps, rule.platformBps, rule.otherBps];

  const floors: [bigint, bigint, bigint] = [0n, 0n, 0n];
  const remainders: { idx: number; rem: bigint }[] = [];
  let sumFloors = 0n;
  for (let i = 0; i < 3; i++) {
    const num = total * BigInt(bps[i] ?? 0);
    const floor = num / 10000n;
    const rem = num % 10000n;
    floors[i] = floor;
    sumFloors += floor;
    remainders.push({ idx: i, rem });
  }
  let leftover = total - sumFloors;
  remainders.sort((a, b) => (a.rem > b.rem ? -1 : a.rem < b.rem ? 1 : a.idx - b.idx));
  let i = 0;
  while (leftover > 0n) {
    const r = remainders[i % remainders.length];
    const idx = r!.idx;
    floors[idx] = (floors[idx] ?? 0n) + 1n;
    leftover -= 1n;
    i++;
  }

  return {
    publisher: Money.of(floors[0]!, recognized.currency),
    platform: Money.of(floors[1]!, recognized.currency),
    other: Money.of(floors[2]!, recognized.currency),
    roundingVersion: rule.roundingVersion,
    currency: recognized.currency,
  };
}
