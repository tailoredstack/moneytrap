import { webAssets } from "./web-assets.generated";

// URL path -> path of the file embedded in the binary. build.ts generates `web-assets.generated.ts`, so the
// compiled binary carries every file and reads nothing from disk at runtime.
export type WebAssets = Readonly<Record<string, string>>;

// Vite puts content-hashed bundles under /assets/. The hash changes with the content, so these never change.
const hashedPrefix = "/assets/";
const fileExtension = /\.[a-z0-9]+$/i;

// Serves an embedded file. Unknown paths without a file extension are app routes, so they get the shell and
// the client router decides what to show. Unknown paths with an extension are missing files.
export function serveWebAsset(pathname: string, assets: WebAssets = webAssets): Response | undefined {
  const exact = assets[pathname];
  if (exact) return fileResponse(exact, pathname.startsWith(hashedPrefix));
  if (fileExtension.test(pathname)) return undefined;
  const shell = assets["/"];
  return shell ? fileResponse(shell, false) : undefined;
}

function fileResponse(path: string, hashed: boolean): Response {
  const file = Bun.file(path);
  return new Response(file, {
    headers: {
      "content-type": file.type,
      "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
}
