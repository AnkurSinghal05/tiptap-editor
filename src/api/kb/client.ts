import type { KbExchange } from "./apiLog";
import { kbRoutes, type KbRoute } from "./routes";
import type {
  AddClauseBody,
  ClauseIdsResult,
  ClauseNodeJSON,
  DeleteClausesBody,
  DocType,
  FieldError,
  KbDocument,
  ListDocumentsParams,
  Pagination,
} from "./types";

export class KbApiError extends Error {
  constructor(
    // 0 when the request never got a response (network error / timeout).
    readonly status: number,
    message: string,
    // Validation problems (400 "validation_error"), with dotted request paths.
    readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
  }
}

export interface KbApi {
  listDocuments(params: ListDocumentsParams): Promise<{ documents: KbDocument[]; pagination: Pagination }>;
  createDocument(document: KbDocument): Promise<KbDocument>;
  // One new clause. Several at once go through `append`.
  addClause(body: AddClauseBody): Promise<ClauseIdsResult>;
  append(document: KbDocument): Promise<ClauseIdsResult>;
  updateClause(
    clauseId: string,
    body: { type: DocType; entity_id: string; clause: ClauseNodeJSON },
  ): Promise<ClauseIdsResult>;
  // 1 to 50 clauses of one entity, all or nothing. A 404 lists every
  // missing id as `clause_ids[<index>]`.
  deleteClauses(body: DeleteClausesBody): Promise<ClauseIdsResult>;
}

export interface Envelope<T> {
  message: string;
  code: number;
  data: T;
  pagination?: Pagination;
  errors?: FieldError[];
}

export const createHttpKbApi = (opts: {
  baseUrl: string;
  token?: string;
  projectCode: string;
  // Called after every request with the raw response (for the API log).
  onExchange?: (exchange: KbExchange) => void;
}): KbApi => {
  const base = opts.baseUrl.replace(/\/$/, "");

  const request = async <T>(route: KbRoute): Promise<Envelope<T>> => {
    const headers: Record<string, string> = { "Project-Code": opts.projectCode };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (route.body !== undefined) headers["Content-Type"] = "application/json";

    const at = new Date().toISOString();
    const startedAt = performance.now();
    let res: Response;
    try {
      res = await fetch(`${base}${route.path}`, {
        method: route.method,
        credentials: "include",
        headers,
        body: route.body === undefined ? undefined : JSON.stringify(route.body),
      });
    } catch {
      const message = "Could not reach the knowledge base service.";
      opts.onExchange?.({ route, status: 0, response: { error: message, note: "No response from the server." }, startedAt, at });
      throw new KbApiError(0, message);
    }

    // Read as text first so a non-JSON body still shows up in the log.
    const text = await res.text().catch(() => "");
    let body: Partial<Envelope<T>> = {};
    let raw: unknown = text;
    try {
      raw = JSON.parse(text);
      if (raw && typeof raw === "object") body = raw as Partial<Envelope<T>>;
    } catch {
      // non-JSON body
    }
    opts.onExchange?.({ route, status: res.status, response: raw, startedAt, at });
    if (!res.ok) {
      throw new KbApiError(res.status, body.message ?? `Request failed (${res.status}).`, body.errors ?? []);
    }
    return body as Envelope<T>;
  };

  return {
    async listDocuments(params) {
      const res = await request<KbDocument[]>(kbRoutes.listDocuments(params));
      return {
        documents: res.data ?? [],
        pagination: res.pagination ?? { limit: 0, offset: 0, total: res.data?.length ?? 0, pages: 1 },
      };
    },
    createDocument: async (document) => (await request<KbDocument>(kbRoutes.createDocument(document))).data,
    addClause: async (body) => (await request<ClauseIdsResult>(kbRoutes.addClause(body))).data,
    append: async (document) => (await request<ClauseIdsResult>(kbRoutes.append(document))).data,
    updateClause: async (clauseId, body) =>
      (await request<ClauseIdsResult>(kbRoutes.updateClause(clauseId, body))).data,
    deleteClauses: async (body) => (await request<ClauseIdsResult>(kbRoutes.deleteClauses(body))).data,
  };
};
