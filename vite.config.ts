import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Live Knowledge Base API; keep in sync with DEFAULT_KB_API_BASE_URL in
// src/api/kb/config.ts.
const DEFAULT_KB_API_BASE_URL = "https://stag-pgm-mgmt-api.thriwe.com/api/v1";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  // Split "https://host/api/v1" into the origin and the path prefix.
  const [, origin, basePath = ""] =
    /^(https?:\/\/[^/]+)(\/.*)?$/.exec(env.VITE_KB_API_BASE_URL || DEFAULT_KB_API_BASE_URL) ?? [];
  if (!origin) throw new Error("VITE_KB_API_BASE_URL must be an http(s) URL");

  return {
    plugins: [react()],
    server: {
      // VITE_KB_API_DEV_PROXY=off: the app calls the API directly (see
      // KB_API_DEV_PROXY in src/api/kb/config.ts), so no proxy is needed.
      proxy: env.VITE_KB_API_DEV_PROXY === "off" ? undefined : {
        // The API sends no CORS headers for localhost, so in development the
        // app calls /kb-api/... and this forwards it (KB_API_DEV_PROXY_PATH).
        "/kb-api": {
          target: origin,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/kb-api/, basePath.replace(/\/$/, "")),
          configure: (proxy) => {
            // Present the request as server-to-server.
            proxy.on("proxyReq", (proxyReq) => proxyReq.removeHeader("origin"));
          },
        },
      },
    },
  };
});
