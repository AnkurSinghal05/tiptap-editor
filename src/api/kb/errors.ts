import { KbApiError } from "./client";
import { KB_API_TOKEN } from "./config";
import { apiMode } from "./index";

// A hint for when live mode is refused because no development token is set.
export const missingTokenHint = (err: unknown): string | null => {
  const unauthorized = err instanceof KbApiError && (err.status === 401 || err.status === 403);
  return unauthorized && apiMode === "live" && import.meta.env.DEV && !KB_API_TOKEN
    ? "No session token is set. Put it in VITE_KB_TOKEN in .env.local (not .env.example), then restart npm run dev."
    : null;
};
