// Better Fetch returns an error without the response headers, so a rate limit's wait is lost. This wrapper copies
// Retry-After (in seconds) into the 429 body, where the client error keeps it as `retryAfter`.
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function withRetryAfter(baseFetch: FetchLike): FetchLike {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status !== 429) return response;
    const body: unknown = await response.json().catch(() => ({}));
    const fields = typeof body === "object" && body !== null ? body : {};
    const retryAfter = parseSeconds(response.headers.get("retry-after"));
    return new Response(JSON.stringify({ ...fields, retryAfter }), {
      status: response.status,
      statusText: response.statusText,
      headers: { "content-type": "application/json" },
    });
  };
}

// Only the seconds form. An HTTP date returns null, and the screen shows the no-time message.
function parseSeconds(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}
