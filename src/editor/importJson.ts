import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { DOC_TYPES, type DocType } from "../api/kb/types";
import { findSaveProblems } from "./extensions/StructureGuard";
import { WORKFLOWS, isOneOf, labelOf } from "./taxonomy";
import { generateTempClauseId } from "./utils/ids";

// Turns pasted JSON into a new document for one vertical (entity).

export interface ImportTarget {
  docType: DocType;
  entityId: string;
  // The vertical's name, used as the document title when the JSON has none.
  title: string;
}

export type ImportResult =
  | { ok: true; doc: PMNode; clauses: number; warnings: string[] }
  | { ok: false; errors: string[] };

export const STRUCTURE_HINT =
  "A section holds a title, then clauses, then subsections. A subsection holds a title, clauses, then workflows. A workflow holds a title and clauses.";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const typeLabel = (type: string) => DOC_TYPES.find((t) => t.value === type)?.label ?? type;
const heading = (level: number, text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

// The document in what was pasted: `{ type, doc }` (the body of
// POST /knowledge-base), an API response with `data`, a Tiptap doc, or a
// single section.
const unwrap = (value: unknown, target: ImportTarget, warnings: string[]): JSONContent | string => {
  let v = value;
  if (isObject(v) && "data" in v) {
    if (Array.isArray(v.data)) {
      if (v.data.length === 0) return "The response has no documents in `data`.";
      if (v.data.length > 1) warnings.push(`The response has ${v.data.length} documents; only the first is used.`);
      v = v.data[0];
    } else {
      v = v.data;
    }
  }
  if (isObject(v) && isObject(v.doc)) {
    if (typeof v.type === "string" && v.type !== target.docType) {
      warnings.push(
        `The JSON's type is ${typeLabel(v.type)}. It will be saved as ${labelOf(DOC_TYPES, target.docType)}.`,
      );
    }
    v = v.doc;
  }
  if (isObject(v) && v.type === "section") v = { type: "doc", content: [v] };
  if (!isObject(v) || v.type !== "doc") {
    return 'Expected a document: { "type": "tnc", "doc": { … } }, an API response with "data", a Tiptap doc or a single section.';
  }
  return v as JSONContent;
};

// Fills in what the editor needs and the API doesn't: a title in every
// container (with the level the container sets), and temp ids on clauses
// (the server assigns real ids when the document is created).
const prepare = (section: JSONContent, target: ImportTarget, added: string[], errors: string[]): JSONContent => {
  const withTitle = (node: JSONContent, level: number, fallback: string | undefined, what: string): JSONContent => {
    const [first, ...rest] = node.content ?? [];
    if (first?.type === "heading") return { ...node, content: [{ ...first, attrs: { ...first.attrs, level } }, ...rest] };
    if (!fallback) {
      errors.push(`${what[0].toUpperCase()}${what.slice(1)} has no title or name.`);
      return node;
    }
    added.push(what);
    return { ...node, content: [heading(level, fallback), ...(node.content ?? [])] };
  };

  const visit = (node: JSONContent): JSONContent => {
    if (node.type === "clause") {
      const tags = Array.isArray(node.attrs?.tags) ? node.attrs!.tags : [];
      return { ...node, attrs: { id: generateTempClauseId(), tags } };
    }
    if (node.type === "subSection") {
      const name = typeof node.attrs?.name === "string" ? node.attrs.name.trim() : "";
      const what = `subsection "${node.attrs?.id ?? "?"}"`;
      return withTitle({ ...node, content: (node.content ?? []).map(visit) }, 2, name || undefined, what);
    }
    if (node.type === "workflow") {
      const id = node.attrs?.id;
      const label = isOneOf(WORKFLOWS, id) ? labelOf(WORKFLOWS, id) : typeof id === "string" ? id : undefined;
      return withTitle({ ...node, content: (node.content ?? []).map(visit) }, 3, label, `workflow "${id ?? "?"}"`);
    }
    return node;
  };

  const content = (section.content ?? []).map(visit);
  return withTitle({ ...section, attrs: { ...section.attrs, id: target.entityId }, content }, 1, target.title, "the document");
};

export const parseDocumentJson = (text: string, target: ImportTarget, schema: Schema): ImportResult => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`Not valid JSON: ${messageOf(err)}`] };
  }

  const warnings: string[] = [];
  const doc = unwrap(value, target, warnings);
  if (typeof doc === "string") return { ok: false, errors: [doc] };

  const sections = doc.content ?? [];
  if (sections.length !== 1 || sections[0].type !== "section") {
    return { ok: false, errors: [`The document must hold exactly one section (the vertical); it holds ${sections.length} top-level nodes.`] };
  }
  const id = sections[0].attrs?.id;
  if (id && id !== target.entityId) {
    warnings.push(`The section's id "${id}" is replaced with "${target.entityId}", the vertical you picked.`);
  }

  const errors: string[] = [];
  const added: string[] = [];
  const section = prepare(sections[0], target, added, errors);
  if (errors.length > 0) return { ok: false, errors };
  if (added.length > 0) warnings.push(`Titles were added where missing: ${added.join(", ")}.`);

  let node: PMNode;
  try {
    node = schema.nodeFromJSON({ type: "doc", content: [section] });
    node.check();
  } catch (err) {
    return { ok: false, errors: [`It doesn't fit the document structure: ${messageOf(err)}`, STRUCTURE_HINT] };
  }

  let clauses = 0;
  node.descendants((n) => {
    if (n.type.name === "clause") clauses++;
    return n.type.name !== "clause";
  });
  const problems = findSaveProblems(node);
  if (clauses === 0) problems.push("The document has no clauses. Add at least one.");
  if (problems.length > 0) return { ok: false, errors: problems };
  return { ok: true, doc: node, clauses, warnings };
};
