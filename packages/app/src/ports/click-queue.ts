import type { ClickObservation } from "./click-store";

// Hands one observed click to the ingestion path (WP-5.8). The redirect calls it after it has decided, and never awaits
// it, so an enqueue that fails or stalls cannot change the response. The consumer records the click through recordClick,
// which dedupes by dedupKey, so a click enqueued twice is still one fact.
export interface ClickQueue {
  enqueue(click: ClickObservation): Promise<void>;
}
