import type { JSONContent } from "@tiptap/core";

// Wire types for the Knowledge Base API (/api/v1/knowledge-base).
// See docs/kb-api-integration.md and the backend's frontend handoff.

export const DOC_TYPES = [
  { value: "tnc", label: "Terms & Conditions" },
  { value: "faq", label: "FAQ" },
  { value: "sla", label: "SLA" },
  { value: "redemption_process", label: "Redemption process" },
] as const;

export type DocType = (typeof DOC_TYPES)[number]["value"];

// `doc` is a Tiptap doc holding exactly one `section` (the entity).
export interface KbDocument {
  type: DocType;
  doc: JSONContent;
}

export interface Pagination {
  limit: number;
  offset: number;
  total: number;
  pages: number;
}

export interface ListDocumentsParams {
  type?: DocType;
  entity_id?: string;
  sub_section_type?: string;
  sub_section_id?: string;
  workflow_id?: string;
  limit?: number;
  offset?: number;
}

// Clause as sent in PATCH / single add: id is ignored by the server.
export interface ClauseNodeJSON {
  type: "clause";
  attrs: { tags: string[] };
  content: JSONContent[];
}

// Body of a single add (POST /knowledge-base/clauses). `name` and `heading`
// are only used when that subSection or workflow doesn't exist yet.
export interface AddClauseBody {
  type: DocType;
  entity_id: string;
  sub_section?: { type: string; id: string; name: string };
  workflow?: { id: string; heading: string };
  clause: ClauseNodeJSON;
}

// What every clause write returns (add, append, update, delete): the ids of
// the clauses it touched, in request order. No document: reload with GET.
export interface ClauseIdsResult {
  clause_ids: string[];
}

export interface FieldError {
  field: string;
  message: string;
}
