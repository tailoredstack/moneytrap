import type { ClickQueue } from "@moneytrap/app/src/ports/click-queue";
import type { ClickObservation } from "@moneytrap/app/src/ports/click-store";

/** In-memory click queue. `failure` simulates an outage, so enqueue rejects. */
export class FakeClickQueue implements ClickQueue {
  private readonly jobs: ClickObservation[] = [];
  failure: Error | null = null;

  async enqueue(click: ClickObservation): Promise<void> {
    if (this.failure) throw this.failure;
    this.jobs.push({ ...click });
  }

  enqueued(): readonly ClickObservation[] {
    return this.jobs.map((click) => ({ ...click }));
  }
}
