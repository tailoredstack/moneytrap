import { describe, test } from "bun:test";

// Milestone M4 (wave 5): links, redirect, and click trace.
describe("[M4] link conformance", () => {
  test.todo("[M4] CT-011 destination redirects to unsafe host: visitor opens link");
  test.todo("[M4] CT-013 click emitted twice: analytics ingests duplicate");
  test.todo("[M4] CT-014 link revoked while route view stale: redirect attempted");
});
