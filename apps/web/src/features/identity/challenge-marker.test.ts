import { describe, expect, test } from "bun:test";
import { clearStepUpPending, isStepUpPending, markStepUpPending } from "./challenge-marker";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  } as unknown as Storage;
}

describe("step-up pending marker (TP-W2-043)", () => {
  test("a sign-in that needs a second factor marks the browser session", () => {
    const storage = memoryStorage();
    markStepUpPending(storage);
    expect(isStepUpPending(storage)).toBe(true);
  });

  test("with no marker, step-up is not pending, so a typed URL cannot make it so", () => {
    expect(isStepUpPending(memoryStorage())).toBe(false);
    expect(isStepUpPending(undefined)).toBe(false);
  });

  test("a finished or expired challenge clears the marker", () => {
    const storage = memoryStorage();
    markStepUpPending(storage);
    clearStepUpPending(storage);
    expect(isStepUpPending(storage)).toBe(false);
  });
});
