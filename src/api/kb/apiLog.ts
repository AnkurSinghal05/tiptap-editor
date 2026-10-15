import { KbApiError, type Envelope, type KbApi } from "./client";
import { PROJECT_CODE } from "./config";
import { kbRoutes, type KbRoute } from "./routes";

// Records every API call (endpoint, payload, response) for the API log tab.
// Responses are shown in the real API's envelope, so the log reads like the
// backend's traffic.

export interface ApiLogEntry {
  id: number;
  // ISO timestamp of when the call started.
  at: string;
  method: KbRoute["method"];
  path: string;
  headers: Record<string, string>;
  requestBody?: unknown;
  // 0 when there was no response (network error).
  status: number;
  response: unknown;
  durationMs: number;
}

const MAX_ENTRIES = 200;

export interface ApiLog {
  entries(): ApiLogEntry[];
  subscribe(listener: () => void): () => void;
  clear(): void;
}

export const createApiLog = () => {
  let entries: ApiLogEntry[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  const log: ApiLog & { add(entry: Omit<ApiLogEntry, "id">): void } = {
    // Newest first; a new array on every change (for useSyncExternalStore).
    entries: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      entries = [];
      notify();
    },
    add(entry) {
      entries = [{ ...entry, id: nextId++ }, ...entries].slice(0, MAX_ENTRIES);
      notify();
    },
  };
  return log;
};

const snapshot = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

// Wraps an API so every call is recorded in `log` and mirrored to the console.
export const withApiLog = (api: KbApi, log: ReturnType<typeof createApiLog>, label = "kb api"): KbApi => {
  const record = async <T>(route: KbRoute, call: () => Promise<T>, toEnvelope: (result: T) => Envelope<unknown>) => {
    const started = performance.now();
    const at = new Date().toISOString();
    const base = {
      at,
      method: route.method,
      path: route.path,
      headers: { "Project-Code": PROJECT_CODE },
      requestBody: snapshot(route.body),
    };
    try {
      const result = await call();
      const envelope = toEnvelope(result);
      const entry = { ...base, status: envelope.code, response: snapshot(envelope), durationMs: Math.round(performance.now() - started) };
      log.add(entry);
      console.debug(`[${label}] ${entry.method} ${entry.path} → ${entry.status}`, entry);
      return result;
    } catch (err) {
      const status = err instanceof KbApiError ? err.status : 0;
      const message = err instanceof Error ? err.message : String(err);
      const response =
        status === 0
          ? { error: message, note: "No response from the server." }
          : {
              message,
              code: status,
              ...(err instanceof KbApiError && err.fieldErrors.length > 0 && { errors: err.fieldErrors }),
            };
      const entry = { ...base, status, response: snapshot(response), durationMs: Math.round(performance.now() - started) };
      log.add(entry);
      console.debug(`[${label}] ${entry.method} ${entry.path} → ${status || "no response"}`, entry);
      throw err;
    }
  };

  const ok = <T>(route: KbRoute) => (data: T): Envelope<unknown> => ({ message: "Success", code: route.successStatus, data });

  return {
    listDocuments(params) {
      const route = kbRoutes.listDocuments(params);
      return record(route, () => api.listDocuments(params), (r) => ({
        message: "Success",
        code: route.successStatus,
        data: r.documents,
        pagination: r.pagination,
      }));
    },
    createDocument(document) {
      const route = kbRoutes.createDocument(document);
      return record(route, () => api.createDocument(document), ok(route));
    },
    addClause(body) {
      const route = kbRoutes.addClause(body);
      return record(route, () => api.addClause(body), ok(route));
    },
    append(document) {
      const route = kbRoutes.append(document);
      return record(route, () => api.append(document), ok(route));
    },
    updateClause(clauseId, body) {
      const route = kbRoutes.updateClause(clauseId, body);
      return record(route, () => api.updateClause(clauseId, body), ok(route));
    },
    deleteClauses(body) {
      const route = kbRoutes.deleteClauses(body);
      return record(route, () => api.deleteClauses(body), ok(route));
    },
  };
};
