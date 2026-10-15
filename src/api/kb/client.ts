import { kbRoutes, type KbRoute } from "./routes";
import type {
  AddClauseBody,
  ClauseIdsResult,
  ClauseNodeJSON,
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
  deleteClause(clauseId: string, type: DocType, entityId: string): Promise<ClauseIdsResult>;
}

export interface Envelope<T> {
  message: string;
  code: number;
  data: T;
  pagination?: Pagination;
  errors?: FieldError[];
}

// Clause writes return `{ clause_ids: [...] }` (backend change of Oct 15,
// 2026). Earlier responses had a single `clause_id`; that's still accepted
// until every endpoint is confirmed on the new shape.
const toClauseIds = (data: { clause_ids?: string[]; clause_id?: string } | null | undefined): ClauseIdsResult => ({
  clause_ids: data?.clause_ids ?? (data?.clause_id ? [data.clause_id] : []),
});

type ClauseWriteData = { clause_ids?: string[]; clause_id?: string };

export const createHttpKbApi = (opts: {
  baseUrl: string;
  token?: string;
  projectCode: string;
}): KbApi => {
  const base = opts.baseUrl.replace(/\/$/, "");

  const request = async <T>(route: KbRoute): Promise<Envelope<T>> => {
    const headers: Record<string, string> = { "Project-Code": opts.projectCode };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (route.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(`${base}${route.path}`, {
        method: route.method,
        credentials: "include",
        headers,
        body: route.body === undefined ? undefined : JSON.stringify(route.body),
      });
    } catch {
      throw new KbApiError(0, "Could not reach the knowledge base service.");
    }

    let body: Partial<Envelope<T>> = {};
    try {
      body = await res.json();
    } catch {
      // non-JSON body
    }
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
    addClause: async (body) => toClauseIds((await request<ClauseWriteData>(kbRoutes.addClause(body))).data),
    append: async (document) => toClauseIds((await request<ClauseWriteData>(kbRoutes.append(document))).data),
    updateClause: async (clauseId, body) =>
      toClauseIds((await request<ClauseWriteData>(kbRoutes.updateClause(clauseId, body))).data),
    deleteClause: async (clauseId, type, entityId) =>
      toClauseIds((await request<ClauseWriteData>(kbRoutes.deleteClause(clauseId, type, entityId))).data),
  };
};
