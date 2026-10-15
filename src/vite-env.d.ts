/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Knowledge Base API base URL (including /api/v1). Unset → in-memory mock.
  readonly VITE_KB_API_BASE_URL?: string;
  // Session token for local development.
  readonly VITE_KB_TOKEN?: string;
}
