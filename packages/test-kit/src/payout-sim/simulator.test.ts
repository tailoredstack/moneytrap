import { describe, expect, test } from "bun:test";
import type { StatusCallbackEnvelope, TransferRequest } from "@moneytrap/app/src/ports/payout-provider";
import { Money } from "@moneytrap/domain";
import { PayoutProviderSimulator } from "./simulator";

const request: TransferRequest = {
  requestId: "req_1",
  amount: Money.of(5000n, "USD"),
  payoutMethodRef: "pm_ref_1",
};

function bodyOf(envelope: StatusCallbackEnvelope): { eventId: string; status: string; sequence: number } {
  return JSON.parse(envelope.body);
}

describe("PayoutProviderSimulator (WP-7.4)", () => {
  test("TP-W7-019 a happy transfer is accepted and its callbacks arrive processing then paid", async () => {
    const provider = new PayoutProviderSimulator("happy");

    const accepted = await provider.initiateTransfer(request);
    const callbacks = provider.takeCallbacks();

    expect(accepted.ok).toBe(true);
    expect(callbacks.map((envelope) => bodyOf(envelope).status)).toEqual(["processing", "paid"]);
    expect(callbacks.map((envelope) => bodyOf(envelope).sequence)).toEqual([1, 2]);
  });

  test("TP-W7-020 a timeout on dispatch is a timeout, never a failure or an accepted transfer", async () => {
    const provider = new PayoutProviderSimulator("timeout-then-absent");

    const first = await provider.initiateTransfer(request);

    expect(first).toEqual({ ok: false, failure: { state: "timeout" } });
    expect(await provider.inspectTransfer(request.requestId)).toEqual({ ok: true, value: null });
  });

  test("TP-W7-021 a timed-out dispatch that the provider created is visible on query", async () => {
    const provider = new PayoutProviderSimulator("timeout-then-exists");

    const first = await provider.initiateTransfer(request);
    const inspected = await provider.inspectTransfer(request.requestId);

    expect(first).toEqual({ ok: false, failure: { state: "timeout" } });
    expect(inspected.ok && inspected.value?.status).toBe("paid");
  });

  test("TP-W7-021 a retry after a timeout that left a transfer creates no second transfer", async () => {
    const provider = new PayoutProviderSimulator("timeout-then-exists");
    await provider.initiateTransfer(request);

    const retry = await provider.initiateTransfer(request);

    expect(retry.ok && retry.value.transferId).toBe("tr_req_1");
    expect(provider.takeCallbacks()).toHaveLength(2);
  });

  test("two stacked query timeouts both fire before a query succeeds", async () => {
    const provider = new PayoutProviderSimulator("happy");
    await provider.initiateTransfer(request);
    provider.timeoutNextInspections(1);
    provider.timeoutNextInspections(1);

    expect((await provider.inspectTransfer(request.requestId)).ok).toBe(false);
    expect((await provider.inspectTransfer(request.requestId)).ok).toBe(false);
    expect((await provider.inspectTransfer(request.requestId)).ok).toBe(true);
  });

  test("TP-W7-022 a retry with the same request ID creates the transfer once the provider has none", async () => {
    const provider = new PayoutProviderSimulator("timeout-then-absent");

    await provider.initiateTransfer(request);
    expect(await provider.inspectTransfer(request.requestId)).toEqual({ ok: true, value: null });

    const retry = await provider.initiateTransfer(request);
    const again = await provider.initiateTransfer(request);

    expect(retry.ok).toBe(true);
    expect(again).toEqual(retry);
    expect(provider.takeCallbacks()).toHaveLength(2);
  });

  test("a reused request ID with a changed amount or payout method is a conflict, never a silent accept", async () => {
    const provider = new PayoutProviderSimulator("happy");
    await provider.initiateTransfer(request);

    const changedAmount = await provider.initiateTransfer({ ...request, amount: Money.of(9999n, "USD") });
    const changedMethod = await provider.initiateTransfer({ ...request, payoutMethodRef: "pm_ref_2" });

    expect(changedAmount).toEqual({ ok: false, failure: { state: "rejected", reason: "request-conflict" } });
    expect(changedMethod).toEqual({ ok: false, failure: { state: "rejected", reason: "request-conflict" } });
  });

  test("TP-W7-023 a query can itself time out and leaves the answer unknown", async () => {
    const provider = new PayoutProviderSimulator("happy");
    await provider.initiateTransfer(request);
    provider.timeoutNextInspections(1);

    expect(await provider.inspectTransfer(request.requestId)).toEqual({
      ok: false,
      failure: { state: "timeout" },
    });
    expect((await provider.inspectTransfer(request.requestId)).ok).toBe(true);
  });

  test("TP-W7-024 a duplicate callback repeats the same event ID so the consumer can dedupe it", async () => {
    const provider = new PayoutProviderSimulator("duplicate-callback");
    await provider.initiateTransfer(request);

    const callbacks = provider.takeCallbacks();
    const eventIds = callbacks.map((envelope) => bodyOf(envelope).eventId);

    expect(callbacks).toHaveLength(4);
    expect(new Set(eventIds).size).toBe(2);
  });

  test("TP-W7-025 out-of-order callbacks arrive paid before processing, and sequence still orders them", async () => {
    const provider = new PayoutProviderSimulator("out-of-order");
    await provider.initiateTransfer(request);

    const callbacks = provider.takeCallbacks();

    expect(callbacks.map((envelope) => bodyOf(envelope).status)).toEqual(["paid", "processing"]);
    expect(callbacks.map((envelope) => bodyOf(envelope).sequence)).toEqual([2, 1]);
  });

  test("TP-W7-028 an outage fails every call as unavailable and creates no transfer", async () => {
    const provider = new PayoutProviderSimulator("outage");

    expect(await provider.initiateTransfer(request)).toEqual({ ok: false, failure: { state: "unavailable" } });
    expect(await provider.inspectTransfer(request.requestId)).toEqual({
      ok: false,
      failure: { state: "unavailable" },
    });
    expect(provider.takeCallbacks()).toEqual([]);
  });

  test("a verified callback returns the event and a forged callback is refused before any field is read", async () => {
    const provider = new PayoutProviderSimulator("happy");
    await provider.initiateTransfer(request);
    const [callback] = provider.takeCallbacks();

    const verified = await provider.receiveStatusCallback(callback as StatusCallbackEnvelope);
    const forged = await provider.receiveStatusCallback({ headers: {}, body: callback?.body ?? "" });

    expect(verified.ok && verified.value.status).toBe("processing");
    expect(forged).toEqual({ ok: false, failure: { state: "rejected", reason: "signature" } });
  });

  test("a signed callback for a transfer this provider never created is refused as unknown-transfer", async () => {
    const provider = new PayoutProviderSimulator("happy");
    const headers = { "x-sim-signature": "sim-valid" };
    const body = JSON.stringify({
      eventId: "evt_1",
      requestId: "req_other",
      transferId: "tr_req_other",
      status: "paid",
      sequence: 2,
      occurredAt: "2026-01-01T00:00:02.000Z",
    });

    expect(await provider.receiveStatusCallback({ headers, body })).toEqual({
      ok: false,
      failure: { state: "rejected", reason: "unknown-transfer" },
    });
  });

  test("a signed callback whose status or sequence the transfer never produced is refused as event-mismatch", async () => {
    const provider = new PayoutProviderSimulator("happy");
    await provider.initiateTransfer(request);
    const headers = { "x-sim-signature": "sim-valid" };
    const base = { eventId: "evt_x", requestId: "req_1", transferId: "tr_req_1" };

    const failed = await provider.receiveStatusCallback({
      headers,
      body: JSON.stringify({ ...base, status: "failed", sequence: 2, occurredAt: "2026-01-01T00:00:02.000Z" }),
    });
    const beyondTimeline = await provider.receiveStatusCallback({
      headers,
      body: JSON.stringify({ ...base, status: "paid", sequence: 99, occurredAt: "2026-01-01T00:01:39.000Z" }),
    });

    expect(failed).toEqual({ ok: false, failure: { state: "rejected", reason: "event-mismatch" } });
    expect(beyondTimeline).toEqual({ ok: false, failure: { state: "rejected", reason: "event-mismatch" } });
  });

  test("a signed callback with a foreign eventId or timestamp for a real sequence is refused as event-mismatch", async () => {
    const provider = new PayoutProviderSimulator("happy");
    await provider.initiateTransfer(request);
    const [callback] = provider.takeCallbacks();
    const event = JSON.parse(callback?.body ?? "{}");
    const headers = callback?.headers ?? {};

    const foreignId = await provider.receiveStatusCallback({
      headers,
      body: JSON.stringify({ ...event, eventId: "evt_other" }),
    });
    const shiftedTime = await provider.receiveStatusCallback({
      headers,
      body: JSON.stringify({ ...event, occurredAt: "2026-01-01T00:05:00.000Z" }),
    });

    expect(foreignId).toEqual({ ok: false, failure: { state: "rejected", reason: "event-mismatch" } });
    expect(shiftedTime).toEqual({ ok: false, failure: { state: "rejected", reason: "event-mismatch" } });
  });

  test("a callback with an empty event ID is refused as malformed, so dedupe cannot merge unrelated events", async () => {
    const provider = new PayoutProviderSimulator("happy");
    await provider.initiateTransfer(request);
    const [callback] = provider.takeCallbacks();
    const event = JSON.parse(callback?.body ?? "{}");

    const result = await provider.receiveStatusCallback({
      headers: callback?.headers ?? {},
      body: JSON.stringify({ ...event, eventId: "" }),
    });

    expect(result).toEqual({ ok: false, failure: { state: "rejected", reason: "malformed" } });
  });

  test("a callback with an unparseable time or a sequence below 1 is refused as malformed", async () => {
    const provider = new PayoutProviderSimulator("happy");
    const headers = { "x-sim-signature": "sim-valid" };
    const base = { eventId: "evt_1", requestId: "req_1", transferId: "tr_req_1", status: "paid" };

    const badTime = await provider.receiveStatusCallback({
      headers,
      body: JSON.stringify({ ...base, sequence: 1, occurredAt: "not a date" }),
    });
    const zeroSequence = await provider.receiveStatusCallback({
      headers,
      body: JSON.stringify({ ...base, sequence: 0, occurredAt: "2026-01-01T00:00:01.000Z" }),
    });

    expect(badTime).toEqual({ ok: false, failure: { state: "rejected", reason: "malformed" } });
    expect(zeroSequence).toEqual({ ok: false, failure: { state: "rejected", reason: "malformed" } });
  });
});
