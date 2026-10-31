// Records that this browser session is waiting for a second factor. It lives in sessionStorage, not the URL, so a
// typed link cannot set it. The server still checks the real pending sign-in on every code it receives.
const KEY = "moneytrap.step-up-pending";

export function markStepUpPending(storage: Storage = sessionStorage): void {
  storage.setItem(KEY, "1");
}

export function clearStepUpPending(storage: Storage = sessionStorage): void {
  storage.removeItem(KEY);
}

export function isStepUpPending(storage: Storage | undefined = globalThis.sessionStorage): boolean {
  return storage?.getItem(KEY) === "1";
}
