// A click that a conversion may be attributed to. The publisher comes from the click's link, so a match carries the
// owner the click was made for (DM-036).
export interface AttributableClick {
  dedupKey: string;
  linkId: string;
  publisherId: string;
  occurredAt: Date;
}

// Looks up the clicks that carry a conversion's sub ID. One sub ID may be shared by several clicks, so the store returns
// every one and the matcher chooses. The store does not apply the window; the matcher does.
export interface AttributionClickStore {
  clicksWithSubId(subId: string): Promise<AttributableClick[]>;
}
