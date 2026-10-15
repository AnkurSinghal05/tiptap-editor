// Knowledge Base API settings, read from Vite env vars (see .env.example).

// Base URL including `/api/v1`. Unset → the in-memory mock backend is used.
export const KB_API_BASE_URL: string | undefined = import.meta.env.VITE_KB_API_BASE_URL || undefined;

// Session token sent as `Authorization: Bearer <token>`, for local development
// only: Vite inlines VITE_* values into the bundle, so it's never read in a
// production build. Otherwise the session cookie is used.
export const KB_API_TOKEN: string | undefined = import.meta.env.DEV
  ? import.meta.env.VITE_KB_TOKEN || undefined
  : undefined;

// This milestone edits base clauses only.
export const PROJECT_CODE = "THRIWE_APP";

// Server limit on clauses per create/append request.
export const MAX_CLAUSES_PER_REQUEST = 500;

// Server limit on clause ids per batch delete.
export const MAX_CLAUSES_PER_DELETE = 50;
