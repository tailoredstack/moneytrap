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

  test("TP-W7-022 a retry with the same request ID creates the transfer once the provider has none", async () => {
    const provider = new PayoutProviderSimulator("timeout-then-absent");

    await provider.initiateTransfer(request);
    const retry = await provider.initiateTransfer(request);
    const again = await provider.initiateTransfer(request);

    expect(retry.ok).toBe(true);
    expect(again).toEqual(retry);
    expect(provider.takeCallbacks()).toHaveLength(2);
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
});
