import type { Clock } from "@moneytrap/app/src/ports/clock";
import type { ConnectorFailure } from "@moneytrap/app/src/ports/network-connector";
import type { ConnectorOperation } from "@moneytrap/domain";

export const DEFAULT_BASE_URL = "https://api.linksynergy.com";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// What the adapter reports about an upstream answer it could not use. It names the operation and the kind of problem,
// and nothing from the request or the body, so it is safe to log.
export interface Diagnostic {
  operation: ConnectorOperation;
  kind: "unexpected_status" | "malformed_body" | "unsupported_currency" | "network_error";
  status?: number;
}

export interface ClientConfig {
  clientId: string;
  clientSecret: string;
  accountId: string;
  baseUrl: string;
  clock: Clock;
  fetch: FetchLike;
  requestTimeoutMs: number;
  onDiagnostic: ((diagnostic: Diagnostic) => void) | undefined;
}

// `at` is the instant the upstream reports in its Date header, or the local time when it sends none.
export type Reply =
  | { kind: "ok"; body: unknown; at: Date }
  | { kind: "not_found" }
  | { kind: "failure"; failure: ConnectorFailure };

// Rakuten documents 403 as "the number of requests allowed per minute has been exceeded", so a 403 is retried later.
const RATE_LIMITED_RETRY_SECONDS = 60;
const EVENTS_REQUEST_LIMIT = 100;
const EVENTS_WINDOW_MS = 60_000;
const ADVANCED_REPORTS_REQUEST_LIMIT = 500;
const ADVANCED_REPORTS_WINDOW_MS = 86_400_000;
// An access token lasts 3600 seconds. It is renewed a minute early so a request never carries one about to expire.
const TOKEN_SKEW_MS = 60_000;

interface Token {
  value: string;
  expiresAt: number;
}

// Talks to the Rakuten Advertising API. The access token lives in memory only: it is never persisted, logged, or
// returned. Every upstream problem becomes a ConnectorFailure that carries no upstream text.
export class RakutenClient {
  private token: Token | null = null;
  private tokenRequest: Promise<{ token: Token } | { failure: ConnectorFailure }> | null = null;
  private readonly quotaWindows = new Map<string, { start: number; requests: number }>();

  constructor(private readonly config: ClientConfig) {}

  get(operation: ConnectorOperation, path: string, query: Record<string, string> = {}): Promise<Reply> {
    return this.send(operation, "GET", withQuery(path, query), undefined);
  }

  post(operation: ConnectorOperation, path: string, body: unknown): Promise<Reply> {
    return this.send(operation, "POST", path, JSON.stringify(body));
  }

  diagnose(diagnostic: Diagnostic): void {
    this.config.onDiagnostic?.(diagnostic);
  }

  now(): Date {
    return this.config.clock.now();
  }

  private async send(
    operation: ConnectorOperation,
    method: "GET" | "POST",
    path: string,
    body: string | undefined,
  ): Promise<Reply> {
    // A 401 means the token expired or was revoked early. It is replaced once, and a second 401 is a refused credential.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.accessToken(operation);
      if ("failure" in token) return { kind: "failure", failure: token.failure };

      const quota = this.consumeQuota(path);
      if (quota !== null) return { kind: "failure", failure: unavailable(quota) };

      const response = await this.call(operation, `${this.config.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token.token.value}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body }),
      });
      if ("failure" in response) return { kind: "failure", failure: response.failure };

      const { status } = response.response;
      if (status === 401) {
        // Only the token this call used is dropped. Another call may already have replaced it.
        if (this.token?.value === token.token.value) this.token = null;
        continue;
      }
      return this.interpret(operation, response.response);
    }
    return { kind: "failure", failure: { state: "not_authorized" } };
  }

  // Rakuten applies separate quotas to Events and Advanced Reports. Use UTC-aligned windows and keep each endpoint
  // independent so a saturated Events budget cannot prevent settlement report calls (or vice versa).
  private consumeQuota(path: string): number | null {
    const pathname = new URL(path, this.config.baseUrl).pathname;
    const policy =
      pathname === "/events/1.0/transactions"
        ? { key: "events", limit: EVENTS_REQUEST_LIMIT, duration: EVENTS_WINDOW_MS }
        : pathname === "/advancedreports/1.0"
          ? { key: "advanced-reports", limit: ADVANCED_REPORTS_REQUEST_LIMIT, duration: ADVANCED_REPORTS_WINDOW_MS }
          : null;
    if (policy === null) return null;

    const now = this.config.clock.now().getTime();
    const start = Math.floor(now / policy.duration) * policy.duration;
    const current = this.quotaWindows.get(policy.key);
    const window = current?.start === start ? current : { start, requests: 0 };
    if (window.requests >= policy.limit) return Math.max(1, Math.ceil((start + policy.duration - now) / 1000));
    window.requests += 1;
    this.quotaWindows.set(policy.key, window);
    return null;
  }

  private async interpret(operation: ConnectorOperation, response: Response): Promise<Reply> {
    const { status } = response;
    if (status === 404) return { kind: "not_found" };
    if (status === 403 || status === 429) {
      return { kind: "failure", failure: unavailable(retryAfter(response) ?? RATE_LIMITED_RETRY_SECONDS) };
    }
    if (status >= 500 || status === 408) return { kind: "failure", failure: unavailable(retryAfter(response)) };
    if (status < 200 || status > 299) {
      this.diagnose({ operation, kind: "unexpected_status", status });
      return { kind: "failure", failure: unavailable(null) };
    }
    try {
      if (operation === "retrieve_settlement_evidence") {
        const body = await response.text();
        if (body.trim() === "") throw new Error("empty report");
        return { kind: "ok", body, at: reportedAt(response) ?? this.config.clock.now() };
      }
      const body: unknown = await response.json();
      return { kind: "ok", body, at: reportedAt(response) ?? this.config.clock.now() };
    } catch {
      this.diagnose({ operation, kind: "malformed_body", status });
      return { kind: "failure", failure: unavailable(null) };
    }
  }

  // The Rakuten token endpoint: POST /token with the base64 of "client_id:client_secret" as the Bearer value and the
  // account ID as the form-encoded scope. The response carries access_token and expires_in (seconds).
  private async accessToken(operation: ConnectorOperation): Promise<{ token: Token } | { failure: ConnectorFailure }> {
    const now = this.config.clock.now().getTime();
    if (this.token && this.token.expiresAt > now) return { token: this.token };
    // Concurrent calls share one token request, so a burst does not spend the token endpoint's 100 calls a minute.
    this.tokenRequest ??= this.requestToken(operation).finally(() => {
      this.tokenRequest = null;
    });
    return this.tokenRequest;
  }

  private async requestToken(operation: ConnectorOperation): Promise<{ token: Token } | { failure: ConnectorFailure }> {
    const { clientId, clientSecret, accountId, baseUrl } = this.config;
    const tokenKey = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
    const response = await this.call(operation, `${baseUrl}/token`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenKey}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ scope: accountId }).toString(),
    });
    if ("failure" in response) return { failure: response.failure };

    const { status } = response.response;
    if (status === 400 || status === 401) return { failure: { state: "not_authorized" } };
    if (status === 403 || status === 429) {
      return { failure: unavailable(retryAfter(response.response) ?? RATE_LIMITED_RETRY_SECONDS) };
    }
    if (status < 200 || status > 299) {
      if (status < 500) this.diagnose({ operation, kind: "unexpected_status", status });
      return { failure: unavailable(status >= 500 ? retryAfter(response.response) : null) };
    }
    const parsed = await readToken(response.response);
    if (!parsed) {
      this.diagnose({ operation, kind: "malformed_body", status });
      return { failure: unavailable(null) };
    }
    const token = { value: parsed.value, expiresAt: this.config.clock.now().getTime() + parsed.ttlMs - TOKEN_SKEW_MS };
    this.token = token;
    return { token };
  }

  // A request that never gets an answer (network error, timeout) is the upstream being unavailable for now.
  private async call(
    operation: ConnectorOperation,
    url: string,
    init: RequestInit,
  ): Promise<{ response: Response } | { failure: ConnectorFailure }> {
    try {
      const response = await this.config.fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      return { response };
    } catch {
      this.diagnose({ operation, kind: "network_error" });
      return { failure: unavailable(null) };
    }
  }
}

export function unavailable(retryAfterSeconds: number | null): ConnectorFailure {
  return { state: "temporarily_unavailable", retryAfterSeconds };
}

function withQuery(path: string, query: Record<string, string>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) return path;
  return `${path}?${new URLSearchParams(entries).toString()}`;
}

function retryAfter(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim());
}

function reportedAt(response: Response): Date | null {
  const header = response.headers.get("date");
  if (header === null) return null;
  const at = new Date(header);
  return Number.isNaN(at.getTime()) ? null : at;
}

async function readToken(response: Response): Promise<{ value: string; ttlMs: number } | null> {
  try {
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object") return null;
    const { access_token: value, expires_in: seconds } = body as Record<string, unknown>;
    if (typeof value !== "string" || value === "") return null;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
    return { value, ttlMs: seconds * 1000 };
  } catch {
    return null;
  }
}
