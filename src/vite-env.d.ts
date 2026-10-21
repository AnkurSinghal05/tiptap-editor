/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Live Knowledge Base API base URL (including /api/v1). Defaults to staging.
  readonly VITE_KB_API_BASE_URL?: string;
  // Starting backend: "live" (default) or "mock". The switch in the editor overrides it.
  readonly VITE_KB_API_MODE?: "mock" | "live";
  // Session token for local development.
  readonly VITE_KB_TOKEN?: string;
  // "on": live calls go to /kb-api on the app's own server (the dev server, or
  // api/kb-proxy.ts on Vercel). "off": straight to VITE_KB_API_BASE_URL.
  // Defaults to on in development and off in builds.
  readonly VITE_KB_API_PROXY?: "on" | "off";
  // Old name for VITE_KB_API_PROXY, read in development only.
  readonly VITE_KB_API_DEV_PROXY?: "on" | "off";
}
