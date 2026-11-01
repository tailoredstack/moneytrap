export async function signStatementDownloadUrl(
  objectRef: string,
  options: { baseUrl?: string | undefined; secret?: string | undefined; now: Date },
): Promise<string> {
  if (!options.baseUrl || !options.secret) throw new Error("statement download signing is not configured");
  const expires = Math.floor(options.now.getTime() / 1000) + 300;
  const path = objectRef.split("/").map(encodeURIComponent).join("/");
  const url = new URL(path, options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
  if (url.protocol !== "https:") throw new Error("statement object base URL must use HTTPS");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(options.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Buffer.from(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${url.pathname}\n${expires}`)),
  ).toString("hex");
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}
