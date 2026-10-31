import type { Clock } from "@moneytrap/app/src/ports/clock";

type Duration = { milliseconds?: number; seconds?: number; minutes?: number; hours?: number; days?: number };

export class FakeClock implements Clock {
  private timestamp: number;

  constructor(initial: Date | string = "2020-01-01T00:00:00.000Z") {
    const timestamp = new Date(initial).getTime();
    if (!Number.isFinite(timestamp)) throw new RangeError("invalid initial time");
    this.timestamp = timestamp;
  }

  now(): Date {
    return new Date(this.timestamp);
  }

  advance(duration: Duration): void {
    const units = { milliseconds: 1, seconds: 1_000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
    const amount = Object.entries(units).reduce((sum, [unit, multiplier]) => {
      const value = duration[unit as keyof Duration] ?? 0;
      if (!Number.isFinite(value) || value < 0) throw new RangeError("duration must be finite and nonnegative");
      return sum + value * multiplier;
    }, 0);
    if (!Number.isFinite(amount) || amount <= 0) throw new RangeError("duration must be positive");
    const next = this.timestamp + amount;
    if (!Number.isFinite(next) || Number.isNaN(new Date(next).getTime())) throw new RangeError("time out of range");
    this.timestamp = next;
  }
}
