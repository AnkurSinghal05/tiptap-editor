// Knowledge Base API settings (see .env.example).

export type ApiMode = "mock" | "live";

// The live API, including /api/v1. Defaults to staging.
export const DEFAULT_KB_API_BASE_URL = "https://stag-pgm-mgmt-api.thriwe.com/api/v1";
export const KB_API_TARGET_URL: string = import.meta.env.VITE_KB_API_BASE_URL || DEFAULT_KB_API_BASE_URL;

// Live calls go either straight to KB_API_TARGET_URL, or to /kb-api on the
// app's own server, which forwards them: the dev server in development (see
// vite.config.ts) and api/kb-proxy.ts on Vercel, which also adds the token.
// The API sends no CORS headers for localhost, so the proxy is on by default
// in development; builds call the API directly unless VITE_KB_API_PROXY=on.
// (VITE_KB_API_DEV_PROXY is the old name, read in development only.)
export const KB_API_PROXY_PATH = "/kb-api";
const proxySetting =
  import.meta.env.VITE_KB_API_PROXY ?? (import.meta.env.DEV ? import.meta.env.VITE_KB_API_DEV_PROXY : undefined);
export const KB_API_PROXY = proxySetting ? proxySetting !== "off" : import.meta.env.DEV;
export const KB_API_BASE_URL: string = KB_API_PROXY ? KB_API_PROXY_PATH : KB_API_TARGET_URL;

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

// Projects (sent as the Project-Code header). THRIWE_APP edits the base
// document every program inherits; a program's code edits that program's own
// version (its changes, removals and additions), and can't create documents.
// Keep in sync with KB_API_PROJECT_CODES' default in api/kb-proxy.ts.
export const PROJECTS = [
  { code: "THRIWE_APP", label: "Thriwe" },
  { code: "ENBD_V3", label: "ENBD" },
] as const;

export type ProjectCode = (typeof PROJECTS)[number]["code"];

export const BASE_PROJECT_CODE: ProjectCode = "THRIWE_APP";
const PROJECT_STORAGE_KEY = "kb-project-code";
const isProjectCode = (value: unknown): value is ProjectCode => PROJECTS.some((p) => p.code === value);

// The project chosen with the switch in the header (kept in this browser).
export const getProjectCode = (): ProjectCode => {
  try {
    const stored = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (isProjectCode(stored)) return stored;
  } catch {
    // storage unavailable
  }
  return BASE_PROJECT_CODE;
};

// Takes effect on the next page load (the API client is created once).
export const setProjectCode = (code: ProjectCode) => {
  try {
    localStorage.setItem(PROJECT_STORAGE_KEY, code);
  } catch {
    // storage unavailable: the choice won't stick
  }
};

// Fixed for this page load. The mock only models the base document, so it
// always works as THRIWE_APP.
export const PROJECT_CODE: ProjectCode = getApiMode() === "mock" ? BASE_PROJECT_CODE : getProjectCode();
export const IS_BASE_PROJECT = PROJECT_CODE === BASE_PROJECT_CODE;
export const PROJECT_LABEL = `${PROJECTS.find((p) => p.code === PROJECT_CODE)?.label} (${PROJECT_CODE})`;

// Server limit on clauses per create/append request.
export const MAX_CLAUSES_PER_REQUEST = 500;

// Server limit on clause ids per batch delete.
export const MAX_CLAUSES_PER_DELETE = 50;
