import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { migrate, migrationProvider } from "@moneytrap/adapter-postgres";
import { createApp } from "@moneytrap/server/src/app";
import { createAuth } from "@moneytrap/server/src/auth/config";
import type { AuthMailer } from "@moneytrap/server/src/auth/mailer";
import { apiRoutes } from "@moneytrap/server/src/http/routes";
import { randomIds, systemClock } from "@moneytrap/server/src/system";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

// Milestone M1 (waves 1-2): identity, access, and recovery. Every case drives the in-process app over HTTP, the same
// surface a client sees, with a real Postgres schema per test and a capturing mailer in place of the email provider.
// Runs against a real Postgres when TEST_DATABASE_URL is set (CI provides it). Skipped otherwise.
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const ORIGIN = "https://moneytrap.test";
const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "staple battery horse";
const ADA = "ada@example.test";
const GRACE = "grace@example.test";
const OUTSIDER = "outsider@example.test";

type Sent = { kind: "verify" | "reset" | "invite"; to: string; url: string };

describeWithDatabase("[M1] identity conformance", () => {
  let schema: string;
  let pool: Pool;
  let db: Kysely<unknown>;
  let sent: Sent[];
  let originalFetch: typeof fetch;
  let app: ReturnType<typeof buildApp>;

  // Each case gets its own schema, so cases never see each other's users, tokens, or sessions.
  beforeEach(async () => {
    schema = `ct_identity_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema "${schema}"`);
    await admin.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db, migrationProvider);

    sent = [];
    const mailer: AuthMailer = {
      async sendVerification(to, url) {
        sent.push({ kind: "verify", to, url });
      },
      async sendPasswordReset(to, url) {
        sent.push({ kind: "reset", to, url });
      },
      async sendInvitation(to, url) {
        sent.push({ kind: "invite", to, url });
      },
    };
    // Have I Been Pwned answers every k-anonymity range query with no match, so no test password counts as breached.
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("api.pwnedpasswords.com/range/")) return new Response("", { status: 200 });
      return originalFetch(input);
    }) as typeof fetch;

    app = buildApp(
      createAuth({
        pool,
        secret: "conformance-secret-at-least-32-characters",
        baseURL: ORIGIN,
        mailer,
        // Login and recovery counters are Redis-backed in production. Each case starts with an empty counter.
        rateLimitCounter: {
          async increment() {
            return 1;
          },
          async count() {
            return 0;
          },
        },
      }),
    );
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await db.destroy();
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`drop schema if exists "${schema}" cascade`);
    await admin.end();
  });

  // Builds the app the server runs, minus the listener. No proxy is trusted, so the client IP is the socket peer.
  function buildApp(auth: ReturnType<typeof createAuth>) {
    return createApp({ clock: systemClock, ids: randomIds, readiness: [] }).use(apiRoutes(auth, { trustProxy: false }));
  }

  const call = (method: string, path: string, body?: unknown, cookie?: string) =>
    app.handle(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  const post = (path: string, body: unknown, cookie?: string) => call("POST", path, body, cookie);
  const get = (path: string, cookie?: string) => call("GET", path, undefined, cookie);

  // The Cookie header a client sends back, read from the Set-Cookie headers of a response.
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");

  const tokenIn = (kind: Sent["kind"], to: string) => {
    const message = sent.filter((m) => m.kind === kind && m.to === to).at(-1);
    return new URL(message?.url ?? `${ORIGIN}/none`).searchParams.get("token") ?? "";
  };
  // Reset links carry the token in the path, so Better Auth's redirect path reads it from the last segment.
  const resetTokenFor = (to: string) => {
    const message = sent.filter((m) => m.kind === "reset" && m.to === to).at(-1);
    const url = new URL(message?.url ?? `${ORIGIN}/none`);
    return url.searchParams.get("token") ?? url.pathname.split("/").at(-1) ?? "";
  };

  const signUpVerified = async (email: string) => {
    await post("/api/auth/sign-up/email", { email, password: PASSWORD, name: email });
    await get(`/api/auth/verify-email?token=${encodeURIComponent(tokenIn("verify", email))}`);
    return cookieOf(await post("/api/auth/sign-in/email", { email, password: PASSWORD }));
  };

  const signIn = (email: string, password: string) => post("/api/auth/sign-in/email", { email, password });
  const requestReset = (email: string) =>
    post("/api/auth/request-password-reset", { email, redirectTo: `${ORIGIN}/reset` });
  const redeemReset = (token: string, newPassword = NEW_PASSWORD) =>
    post("/api/auth/reset-password", { newPassword, token });

  // Reads a response body once, as JSON when it parses and as text otherwise, so two responses can be compared.
  const bodyOf = async (response: Response) => {
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  };

  describe("CT-001 unknown identity hint", () => {
    test("recovery requested for an unknown email answers like one for a known email", async () => {
      await signUpVerified(ADA);
      sent = [];

      const known = await requestReset(ADA);
      const unknown = await requestReset(OUTSIDER);

      expect(known.status).toBe(200);
      expect(unknown.status).toBe(known.status);
      expect(await bodyOf(unknown)).toEqual(await bodyOf(known));
    });

    test("recovery for an unknown email sends no email, and the known one sends exactly one", async () => {
      await signUpVerified(ADA);
      sent = [];

      await requestReset(ADA);
      await requestReset(OUTSIDER);

      expect(sent.filter((m) => m.kind === "reset").map((m) => m.to)).toEqual([ADA]);
    });

    test("sign-up for a known email answers like sign-up for an unknown one", async () => {
      await signUpVerified(ADA);

      const known = await post("/api/auth/sign-up/email", { email: ADA, password: PASSWORD, name: "Ada" });
      const unknown = await post("/api/auth/sign-up/email", { email: OUTSIDER, password: PASSWORD, name: "Out" });

      expect(known.status).toBe(unknown.status);
      // The account a sign-up creates has its own ID and timestamps, so the values differ. The keys and value types
      // must match, or a caller could tell a known email from an unknown one.
      expect(shapeOf(await bodyOf(known))).toEqual(shapeOf(await bodyOf(unknown)));
    });
  });

  describe("CT-002 valid recovery proof", () => {
    test("two concurrent redemptions of one reset token yield exactly one credential change", async () => {
      await signUpVerified(ADA);
      await requestReset(ADA);
      const token = resetTokenFor(ADA);

      const responses = await Promise.all([redeemReset(token), redeemReset(token)]);

      expect(responses.map((r) => r.status).filter((status) => status === 200)).toHaveLength(1);
      expect((await signIn(ADA, NEW_PASSWORD)).status).toBe(200);
      expect((await signIn(ADA, PASSWORD)).status).toBeGreaterThanOrEqual(400);
    });

    test("every later use of the same token fails and leaves the new credential in place", async () => {
      await signUpVerified(ADA);
      await requestReset(ADA);
      const token = resetTokenFor(ADA);
      await redeemReset(token);

      const again = await redeemReset(token, "another long passphrase");

      expect(again.status).toBeGreaterThanOrEqual(400);
      expect((await signIn(ADA, NEW_PASSWORD)).status).toBe(200);
      expect((await signIn(ADA, "another long passphrase")).status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("CT-003 expired recovery proof", () => {
    test("redeeming an expired reset token leaves the credential unchanged", async () => {
      await signUpVerified(ADA);
      await requestReset(ADA);
      const token = resetTokenFor(ADA);
      await sql`update "verification" set "expiresAt" = now() - interval '1 minute'
        where "identifier" = ${`reset-password:${token}`}`.execute(db);

      const response = await redeemReset(token);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect((await signIn(ADA, PASSWORD)).status).toBe(200);
      expect((await signIn(ADA, NEW_PASSWORD)).status).toBeGreaterThanOrEqual(400);
    });

    test("after an expired token, a fresh reset request yields a token that works", async () => {
      await signUpVerified(ADA);
      await requestReset(ADA);
      const expired = resetTokenFor(ADA);
      await sql`update "verification" set "expiresAt" = now() - interval '1 minute'
        where "identifier" = ${`reset-password:${expired}`}`.execute(db);
      await redeemReset(expired);

      sent = [];
      await requestReset(ADA);
      const response = await redeemReset(resetTokenFor(ADA));

      expect(response.status).toBe(200);
      expect((await signIn(ADA, NEW_PASSWORD)).status).toBe(200);
    });
  });

  describe("CT-004 prior active sessions", () => {
    test("a password changed through recovery signs out every prior session", async () => {
      const first = await signUpVerified(ADA);
      const second = cookieOf(await signIn(ADA, PASSWORD));
      await requestReset(ADA);

      await redeemReset(resetTokenFor(ADA));

      expect((await get("/api/sessions", first)).status).toBe(401);
      expect((await get("/api/sessions", second)).status).toBe(401);
    });

    test("a password changed through recovery does not bypass two-factor for an enrolled user", async () => {
      const session = await signUpVerified(ADA);
      const { totpURI } = await json<{ totpURI: string }>(
        await post("/api/auth/two-factor/enable", { password: PASSWORD }, session),
      );
      const secret = new URL(totpURI).searchParams.get("secret") ?? "";
      await post("/api/auth/two-factor/verify-totp", { code: totpAt(secret, Date.now()) }, session);
      await requestReset(ADA);

      await redeemReset(resetTokenFor(ADA));
      const signedIn = await signIn(ADA, NEW_PASSWORD);

      expect(signedIn.status).toBe(200);
      expect(await json<{ twoFactorRedirect?: boolean }>(signedIn)).toMatchObject({ twoFactorRedirect: true });
      // Only the second-factor challenge cookie comes back. A session cookie would mean the MFA step was skipped.
      expect((await get("/api/sessions", cookieOf(signedIn))).status).toBe(401);
    });
  });

  describe("CT-005 user with membership in org A only", () => {
    test("a request for an org B resource answers like a request for a missing one", async () => {
      const adaSession = await signUpVerified(ADA);
      const outsiderSession = await signUpVerified(OUTSIDER);
      const org = await json<{ id: string }>(
        await post("/api/auth/organization/create", { name: "Org B", slug: "org-b" }, outsiderSession),
      );

      const foreign = await get(`/api/auth/organization/get-full-organization?organizationId=${org.id}`, adaSession);
      const missing = await get(
        "/api/auth/organization/get-full-organization?organizationId=org_does_not_exist",
        adaSession,
      );

      expect(foreign.status).toBe(missing.status);
      expect(await bodyOf(foreign)).toEqual(await bodyOf(missing));
    });

    test("a mutation aimed at an org B resource changes nothing and answers like a missing one", async () => {
      const adaSession = await signUpVerified(ADA);
      const outsiderSession = await signUpVerified(OUTSIDER);
      const org = await json<{ id: string }>(
        await post("/api/auth/organization/create", { name: "Org B", slug: "org-b" }, outsiderSession),
      );

      const foreign = await post(
        "/api/auth/organization/invite-member",
        { email: GRACE, role: "member", organizationId: org.id },
        adaSession,
      );
      const missing = await post(
        "/api/auth/organization/invite-member",
        { email: GRACE, role: "member", organizationId: "org_does_not_exist" },
        adaSession,
      );

      expect(foreign.status).toBe(missing.status);
      expect(await bodyOf(foreign)).toEqual(await bodyOf(missing));
      expect(await invitationCount(org.id)).toBe(0);
    });

    test("the org B response reveals neither its name nor its members", async () => {
      const adaSession = await signUpVerified(ADA);
      const outsiderSession = await signUpVerified(OUTSIDER);
      const org = await json<{ id: string }>(
        await post("/api/auth/organization/create", { name: "Secret Org B", slug: "secret-org-b" }, outsiderSession),
      );

      const foreign = await get(`/api/auth/organization/get-full-organization?organizationId=${org.id}`, adaSession);
      const text = await foreign.text();

      expect(text).not.toContain("Secret Org B");
      expect(text).not.toContain(OUTSIDER);
    });
  });

  describe("CT-005 refusals and successful removals", () => {
    test("a request that names org B by slug alongside an org A ID is refused like a missing one", async () => {
      const adaSession = await signUpVerified(ADA);
      const adaOrg = await json<{ id: string }>(
        await post("/api/auth/organization/create", { name: "Org A", slug: "org-a" }, adaSession),
      );
      const outsiderSession = await signUpVerified(OUTSIDER);
      const outsiderOrg = await json<{ slug: string }>(
        await post("/api/auth/organization/create", { name: "Org B", slug: "org-b" }, outsiderSession),
      );

      const mixed = await get(
        `/api/auth/organization/get-full-organization?organizationId=${adaOrg.id}&organizationSlug=${outsiderOrg.slug}`,
        adaSession,
      );
      const missing = await get(
        `/api/auth/organization/get-full-organization?organizationId=${adaOrg.id}&organizationSlug=org-missing`,
        adaSession,
      );

      expect(mixed.status).toBe(missing.status);
      expect(await bodyOf(mixed)).toEqual(await bodyOf(missing));
    });

    test("slug availability answers the same for a taken slug as for a free one", async () => {
      const adaSession = await signUpVerified(ADA);
      const outsiderSession = await signUpVerified(OUTSIDER);
      const outsiderOrg = await json<{ slug: string }>(
        await post("/api/auth/organization/create", { name: "Org B", slug: "org-b" }, outsiderSession),
      );

      const taken = await post("/api/auth/organization/check-slug", { slug: outsiderOrg.slug }, adaSession);
      const free = await post("/api/auth/organization/check-slug", { slug: "org-free" }, adaSession);

      expect(taken.status).toBe(free.status);
      expect(await bodyOf(taken)).toEqual(await bodyOf(free));
    });

    test("creating an organization with another organization's slug succeeds and reveals nothing about it", async () => {
      const adaSession = await signUpVerified(ADA);
      const outsiderSession = await signUpVerified(OUTSIDER);
      const outsiderOrg = await json<{ slug: string }>(
        await post("/api/auth/organization/create", { name: "Org B", slug: "org-b" }, outsiderSession),
      );

      const created = await post(
        "/api/auth/organization/create",
        { name: "Org B", slug: outsiderOrg.slug },
        adaSession,
      );
      const body = await json<{ slug?: string }>(created);

      expect(created.status).toBe(200);
      expect(body.slug).not.toBe(outsiderOrg.slug);
    });

    test("an invitation ID from another organization answers like a missing one", async () => {
      const ownerSession = await signUpVerified(ADA);
      const outsiderSession = await signUpVerified(OUTSIDER);
      await signUpVerified(GRACE);
      const org = await json<{ id: string }>(
        await post("/api/auth/organization/create", { name: "Org B", slug: "org-b" }, outsiderSession),
      );
      const invitation = await json<{ id: string }>(
        await post(
          "/api/auth/organization/invite-member",
          { email: GRACE, role: "member", organizationId: org.id },
          outsiderSession,
        ),
      );

      const foreign = await post(
        "/api/auth/organization/accept-invitation",
        { invitationId: invitation.id },
        ownerSession,
      );
      const missing = await post(
        "/api/auth/organization/accept-invitation",
        { invitationId: "inv_missing" },
        ownerSession,
      );

      expect(foreign.status).toBe(missing.status);
      expect(await bodyOf(foreign)).toEqual(await bodyOf(missing));
      expect(await membershipCount(org.id, ADA)).toBe(0);
    });

    test("naming the caller's own invitation in one field does not authorize a foreign one named in the other", async () => {
      const adaSession = await signUpVerified(ADA);
      const outsiderSession = await signUpVerified(OUTSIDER);
      const graceSession = await signUpVerified(GRACE);
      const ownOrg = await json<{ id: string }>(
        await post("/api/auth/organization/create", { name: "Org A", slug: "org-a" }, adaSession),
      );
      const ownInvitation = await json<{ id: string }>(
        await post(
          "/api/auth/organization/invite-member",
          { email: GRACE, role: "member", organizationId: ownOrg.id },
          adaSession,
        ),
      );
      const foreignOrg = await json<{ id: string }>(
        await post("/api/auth/organization/create", { name: "Org B", slug: "org-b" }, outsiderSession),
      );
      const foreignInvitation = await json<{ id: string }>(
        await post(
          "/api/auth/organization/invite-member",
          { email: "other-invitee@example.test", role: "member", organizationId: foreignOrg.id },
          outsiderSession,
        ),
      );

      const mixed = await get(
        `/api/auth/organization/get-invitation?id=${foreignInvitation.id}&invitationId=${ownInvitation.id}`,
        graceSession,
      );
      const missing = await get("/api/auth/organization/get-invitation?id=inv_missing", graceSession);

      const mixedBody = await bodyOf(mixed);
      expect(mixed.status).toBe(missing.status);
      expect(mixedBody).toEqual(await bodyOf(missing));
      expect(JSON.stringify(mixedBody)).not.toContain(foreignInvitation.id);
    });

    test("changing the role of a foreign membership answers like a missing one", async () => {
      const adaSession = await signUpVerified(ADA);
      const outsiderSession = await signUpVerified(OUTSIDER);
      const adaOrg = await json<{ id: string }>(
        await post("/api/auth/organization/create", { name: "Org A", slug: "org-a" }, adaSession),
      );
      await json<{ id: string }>(
        await post("/api/auth/organization/create", { name: "Org B", slug: "org-b" }, outsiderSession),
      );
      const foreignMember = await sql<{
        id: string;
      }>`select "id" from "member" where "userId" = (select "id" from "user" where "email" = ${OUTSIDER})`.execute(db);
      const foreignMemberId = foreignMember.rows[0]?.id ?? "";

      const foreign = await post(
        "/api/auth/organization/update-member-role",
        { memberId: foreignMemberId, role: "member", organizationId: adaOrg.id },
        adaSession,
      );
      const missing = await post(
        "/api/auth/organization/update-member-role",
        { memberId: "mem_missing", role: "member", organizationId: adaOrg.id },
        adaSession,
      );

      expect(foreignMemberId).not.toBe("");
      expect(foreign.status).toBe(missing.status);
      expect(await bodyOf(foreign)).toEqual(await bodyOf(missing));
    });

    test("a member leaving an organization gets a success and loses the membership", async () => {
      const ownerSession = await signUpVerified(ADA);
      const inviteeSession = await signUpVerified(GRACE);
      const org = await json<{ id: string }>(
        await post("/api/auth/organization/create", { name: "Acme", slug: "acme" }, ownerSession),
      );
      const invitation = await json<{ id: string }>(
        await post(
          "/api/auth/organization/invite-member",
          { email: GRACE, role: "member", organizationId: org.id },
          ownerSession,
        ),
      );
      await post("/api/auth/organization/accept-invitation", { invitationId: invitation.id }, inviteeSession);

      const left = await post("/api/auth/organization/leave", { organizationId: org.id }, inviteeSession);

      expect(left.status).toBe(200);
      expect(await membershipCount(org.id, GRACE)).toBe(0);
    });
  });

  describe("CT-008 valid but reused invitation", () => {
    test("reaccepting an accepted invitation leaves one membership", async () => {
      const ownerSession = await signUpVerified(ADA);
      const inviteeSession = await signUpVerified(GRACE);
      const org = await json<{ id: string }>(
        await post("/api/auth/organization/create", { name: "Acme", slug: "acme" }, ownerSession),
      );
      const invitation = await json<{ id: string }>(
        await post(
          "/api/auth/organization/invite-member",
          { email: GRACE, role: "member", organizationId: org.id },
          ownerSession,
        ),
      );

      const first = await post(
        "/api/auth/organization/accept-invitation",
        { invitationId: invitation.id },
        inviteeSession,
      );
      const second = await post(
        "/api/auth/organization/accept-invitation",
        { invitationId: invitation.id },
        inviteeSession,
      );

      expect(first.status).toBe(200);
      expect(second.status).toBeGreaterThanOrEqual(400);
      expect(await membershipCount(org.id, GRACE)).toBe(1);
    });

    test("two concurrent accepts of one invitation leave one membership", async () => {
      const ownerSession = await signUpVerified(ADA);
      const inviteeSession = await signUpVerified(GRACE);
      const org = await json<{ id: string }>(
        await post("/api/auth/organization/create", { name: "Acme", slug: "acme" }, ownerSession),
      );
      const invitation = await json<{ id: string }>(
        await post(
          "/api/auth/organization/invite-member",
          { email: GRACE, role: "member", organizationId: org.id },
          ownerSession,
        ),
      );

      await Promise.all([
        post("/api/auth/organization/accept-invitation", { invitationId: invitation.id }, inviteeSession),
        post("/api/auth/organization/accept-invitation", { invitationId: invitation.id }, inviteeSession),
      ]);

      expect(await membershipCount(org.id, GRACE)).toBe(1);
    });
  });

  const invitationCount = async (organizationId: string) =>
    (
      await sql<{
        n: number;
      }>`select count(*)::int as n from "invitation" where "organizationId" = ${organizationId}`.execute(db)
    ).rows[0]?.n;

  const membershipCount = async (organizationId: string, email: string) =>
    (
      await sql<{ n: number }>`
        select count(*)::int as n from member m join "user" u on u.id = m."userId"
        where m."organizationId" = ${organizationId} and u.email = ${email}`.execute(db)
    ).rows[0]?.n;
});

// The keys and value types of a response body with the values dropped.
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, shapeOf(field)]));
  }
  return typeof value;
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

// RFC 6238 TOTP with the default 30-second step, 6 digits, and SHA-1, the parameters Better Auth issues.
function totpAt(base32Secret: string, now: number): string {
  const key = base32Decode(base32Secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of input.toUpperCase().replace(/=+$/, "")) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
