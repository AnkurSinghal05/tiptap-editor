import { KbApiError, type Envelope, type KbApi } from "./client";
import { PROJECT_CODE } from "./config";
import { kbRoutes, type KbRoute } from "./routes";

// Records every API call (endpoint, payload, response) for the API log tab.
// Live calls are logged with the server's raw response; mock calls with the
// response wrapped in the API's envelope, so both read like backend traffic.

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

export type ApiLogWriter = ReturnType<typeof createApiLog>;

// One request and its outcome, as seen by whoever made the call.
export interface KbExchange {
  route: KbRoute;
  // 0 when there was no response (network error).
  status: number;
  response: unknown;
  // performance.now() and ISO time when the call started.
  startedAt: number;
  at: string;
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

// Adds one exchange to the log and mirrors it to the console (debug level).
// Only `Project-Code` is recorded from the headers, never the token.
export const logExchange = (log: ApiLogWriter, label: string, x: KbExchange) => {
  const entry = {
    at: x.at,
    method: x.route.method,
    path: x.route.path,
    headers: { "Project-Code": PROJECT_CODE },
    requestBody: snapshot(x.route.body),
    status: x.status,
    response: snapshot(x.response),
    durationMs: Math.round(performance.now() - x.startedAt),
  };
  log.add(entry);
  console.debug(`[${label}] ${entry.method} ${entry.path} → ${entry.status || "no response"}`, entry);
};

// Wraps an API (the mock) so every call is recorded in `log`.
export const withApiLog = (api: KbApi, log: ApiLogWriter, label = "kb api"): KbApi => {
  const record = async <T>(route: KbRoute, call: () => Promise<T>, toEnvelope: (result: T) => Envelope<unknown>) => {
    const startedAt = performance.now();
    const at = new Date().toISOString();
    try {
      const result = await call();
      const envelope = toEnvelope(result);
      logExchange(log, label, { route, status: envelope.code, response: envelope, startedAt, at });
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
      logExchange(log, label, { route, status, response, startedAt, at });
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
