import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // API_PROXY_TARGET, read from apps/web/.env (optional, see .env.example), overrides the proxy target. The shell
  // environment wins.
  const webEnv = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "API_PROXY_TARGET");
  // The server reads PORT from apps/server/.env (see its .env.example), so read it from there too. The shell
  // environment wins, and the port falls back to 3000 as the server does.
  const serverEnv = loadEnv(mode, fileURLToPath(new URL("../server", import.meta.url)), "PORT");
  const target = webEnv.API_PROXY_TARGET || `http://127.0.0.1:${serverEnv.PORT ?? 3000}`;

  return {
    plugins: [tailwindcss()],
    build: {
      outDir: "dist",
    },
    server: {
      // Without this, Vite's SPA fallback answers /api/* with index.html. The app's session check then gets HTML.
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          // Better Auth rejects a state-changing request whose Origin is not its baseURL. The browser sends the Vite
          // origin, so the proxy rewrites it to the server's origin, the same one the server expects.
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (proxyReq.getHeader("origin")) proxyReq.setHeader("origin", target);
            });
          },
        },
      },
    },
  };
});
