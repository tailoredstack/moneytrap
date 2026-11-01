import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingScreen } from "./landing-screen";
import { isSignedIn } from "./signed-in";

describe("LandingScreen", () => {
  test("has exactly one level-one heading that says what Moneytrap does", () => {
    const html = renderToStaticMarkup(<LandingScreen />);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain("One place for affiliate links, earnings, and payouts");
  });

  test("explains the publisher and advertiser sides and the main features", () => {
    const html = renderToStaticMarkup(<LandingScreen />);
    expect(html).toContain("For publishers");
    expect(html).toContain("For advertisers");
    expect(html).toContain("Main features");
    expect(html).toContain("Two-factor sign-in and session management");
  });

  test("Sign up and Sign in link to the existing register and login routes", () => {
    const html = renderToStaticMarkup(<LandingScreen />);
    expect(html).toMatch(/<a href="\/register"[^>]*>Sign up<\/a>/);
    expect(html).toMatch(/<a href="\/login"[^>]*>Sign in<\/a>/);
  });

  test("does not invent prices, testimonials, or statistics", () => {
    const html = renderToStaticMarkup(<LandingScreen />);
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toMatch(/\d+%/);
    expect(html.toLowerCase()).not.toContain("testimonial");
  });
});

describe("isSignedIn", () => {
  test("is true when Better Auth returns a session", async () => {
    const reader = { getSession: async () => ({ data: { session: { id: "s1" }, user: { id: "u1" } } }) };
    expect(await isSignedIn(reader)).toBe(true);
  });

  test("is false when there is no session", async () => {
    const reader = { getSession: async () => ({ data: null }) };
    expect(await isSignedIn(reader)).toBe(false);
  });

  test("a failed lookup counts as signed out, so the landing page still loads", async () => {
    const reader = {
      getSession: async (): Promise<{ data: unknown }> => {
        throw new Error("network down");
      },
    };
    expect(await isSignedIn(reader)).toBe(false);
  });
});
