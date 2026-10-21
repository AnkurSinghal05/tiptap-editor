/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Live Knowledge Base API base URL (including /api/v1). Defaults to staging.
  readonly VITE_KB_API_BASE_URL?: string;
  // Starting backend: "live" (default) or "mock". The switch in the editor overrides it.
  readonly VITE_KB_API_MODE?: "mock" | "live";
  // Session token for local development.
  readonly VITE_KB_TOKEN?: string;
  // "off": call the API directly in development instead of through the dev
  // server's /kb-api proxy (needs CORS for the dev server's origin).
  readonly VITE_KB_API_DEV_PROXY?: "on" | "off";
}
