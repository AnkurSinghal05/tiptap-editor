import type { AddClauseBody, ClauseNodeJSON, DeleteClausesBody, DocType, KbDocument, ListDocumentsParams } from "./types";

// Method, path and body of every Knowledge Base API call. Shared by the HTTP
// client and the API log, so the log shows exactly what would be sent.

export interface KbRoute {
  method: "GET" | "POST" | "PATCH";
  // Relative to the base URL (which includes /api/v1), with the query string.
  path: string;
  body?: unknown;
  // Status the real API returns on success.
  successStatus: 200 | 201;
}

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

const clausePath = (clauseId: string) => `/knowledge-base/clauses/${encodeURIComponent(clauseId)}`;

export const kbRoutes = {
  listDocuments: (params: ListDocumentsParams): KbRoute => ({
    method: "GET",
    path: `/knowledge-base${query({ ...params })}`,
    successStatus: 200,
  }),
  createDocument: (document: KbDocument): KbRoute => ({
    method: "POST",
    path: "/knowledge-base",
    body: document,
    successStatus: 201,
  }),
  addClause: (body: AddClauseBody): KbRoute => ({
    method: "POST",
    path: "/knowledge-base/clauses",
    body,
    successStatus: 201,
  }),
  append: (document: KbDocument): KbRoute => ({
    method: "POST",
    path: "/knowledge-base/append",
    body: document,
    successStatus: 201,
  }),
  updateClause: (clauseId: string, body: { type: DocType; entity_id: string; clause: ClauseNodeJSON }): KbRoute => ({
    method: "PATCH",
    path: clausePath(clauseId),
    body,
    successStatus: 200,
  }),
  // A POST with a body, not a DELETE.
  deleteClauses: (body: DeleteClausesBody): KbRoute => ({
    method: "POST",
    path: "/knowledge-base/clauses/delete",
    body,
    successStatus: 200,
  }),
};
