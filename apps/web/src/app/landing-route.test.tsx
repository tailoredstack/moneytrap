import { describe, expect, test } from "bun:test";
import { isRedirect } from "@tanstack/react-router";
import { redirectSignedInVisitor } from "../features/landing/landing-guard";
import { createAppRouter } from "./router";

// Runs the redirect guard that the "/" route uses, and reports the redirect target if one is thrown.
async function redirectTargetFor(isSignedIn: () => Promise<boolean>): Promise<string | undefined> {
  try {
    await redirectSignedInVisitor(isSignedIn);
    return undefined;
  } catch (error) {
    if (isRedirect(error)) return error.options.href;
    throw error;
  }
}

describe("landing route redirect", () => {
  test("a signed-in visitor who opens / is sent to /overview", async () => {
    expect(await redirectTargetFor(async () => true)).toBe("/overview");
  });

  test("a signed-out visitor is not redirected and sees the landing page", async () => {
    expect(await redirectTargetFor(async () => false)).toBeUndefined();
  });

  test("the / route runs the same guard with the router's session check", async () => {
    const router = createAppRouter(undefined, { isSignedIn: async () => true });
    const landing = router.routesByPath["/"];
    expect(landing).toBeDefined();
    const beforeLoad = landing?.options.beforeLoad;
    expect(beforeLoad).toBeFunction();
    let thrown: unknown;
    try {
      await beforeLoad?.({ context: { isSignedIn: async () => true } } as never);
    } catch (error) {
      thrown = error;
    }
    expect(isRedirect(thrown) && thrown.options.href).toBe("/overview");
  });
});
