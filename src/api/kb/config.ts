// Knowledge Base API settings (see .env.example).

export type ApiMode = "mock" | "live";

// The live API, including /api/v1. Defaults to staging.
export const DEFAULT_KB_API_BASE_URL = "https://stag-pgm-mgmt-api.thriwe.com/api/v1";
export const KB_API_TARGET_URL: string = import.meta.env.VITE_KB_API_BASE_URL || DEFAULT_KB_API_BASE_URL;

// The API doesn't allow browser calls from localhost (no CORS headers), so in
// development live calls go to this path on the dev server, which proxies them
// to KB_API_TARGET_URL (see vite.config.ts). Built apps call the API directly,
// so the API must allow the deployed app's origin.
// VITE_KB_API_DEV_PROXY=off calls the API directly in development too, which
// only works once the API allows the dev server's origin.
export const KB_API_DEV_PROXY_PATH = "/kb-api";
export const KB_API_DEV_PROXY = import.meta.env.DEV && import.meta.env.VITE_KB_API_DEV_PROXY !== "off";
export const KB_API_BASE_URL: string = KB_API_DEV_PROXY ? KB_API_DEV_PROXY_PATH : KB_API_TARGET_URL;

// Session token sent as `Authorization: Bearer <token>`, for local development
// only: Vite inlines VITE_* values into the bundle, so it's never read in a
// production build. Otherwise the session cookie is used.
// Vite reads it from .env.local (not .env.example) when the dev server starts.
// A leading "Bearer " is accepted and dropped.
export const KB_API_TOKEN: string | undefined = import.meta.env.DEV
  ? import.meta.env.VITE_KB_TOKEN?.trim().replace(/^Bearer\s+/i, "") || undefined
  : undefined;

// Mock or live backend: the choice made with the switch in the editor (kept
// in this browser), else VITE_KB_API_MODE, else live.
const MODE_STORAGE_KEY = "kb-api-mode";
const isApiMode = (value: unknown): value is ApiMode => value === "mock" || value === "live";

export const DEFAULT_API_MODE: ApiMode = isApiMode(import.meta.env.VITE_KB_API_MODE)
  ? import.meta.env.VITE_KB_API_MODE
  : "live";

export const getApiMode = (): ApiMode => {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (isApiMode(stored)) return stored;
  } catch {
    // storage unavailable (private mode, blocked site data)
  }
  return DEFAULT_API_MODE;
};

// Takes effect on the next page load (the API client is created once).
export const setApiMode = (mode: ApiMode) => {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // storage unavailable: the choice won't stick
  }
};

// This milestone edits base clauses only.
export const PROJECT_CODE = "THRIWE_APP";

// Server limit on clauses per create/append request.
export const MAX_CLAUSES_PER_REQUEST = 500;

// Server limit on clause ids per batch delete.
export const MAX_CLAUSES_PER_DELETE = 50;
