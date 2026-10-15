import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { AddClauseBody, ClauseNodeJSON, DocType, FieldError, KbDocument } from "../../api/kb/types";
import { isTempClauseId } from "../utils/ids";
import { forEachContainer, titleOf } from "./containerKeys";

// Turns the difference between the loaded document and the edited one into
// Knowledge Base API calls: one append for new clauses, then a PATCH per
// edited clause and a DELETE per removed clause.

export interface ClauseContext {
  // Key of the container the clause sits in (see containerKeys.ts).
  containerKey: string;
  subSection?: { type: string; id: string; name: string };
  workflow?: { id: string; title: string };
}

export interface ClauseVisit {
  node: PMNode;
  pos: number;
  ctx: ClauseContext;
}

export const forEachClause = (doc: PMNode, fn: (visit: ClauseVisit) => void) => {
  forEachContainer(doc, ({ node, pos, key }) => {
    let subSection: ClauseContext["subSection"];
    let workflow: ClauseContext["workflow"];
    if (node.type.name === "workflow") {
      const $pos = doc.resolve(pos);
      const sub = $pos.parent;
      subSection = { type: sub.attrs.type, id: sub.attrs.id, name: titleOf(sub) };
      workflow = { id: node.attrs.id, title: titleOf(node) };
    } else if (node.type.name === "subSection") {
      subSection = { type: node.attrs.type, id: node.attrs.id, name: titleOf(node) };
    }
    node.forEach((child, offset) => {
      if (child.type.name === "clause") {
        fn({ node: child, pos: pos + 1 + offset, ctx: { containerKey: key, subSection, workflow } });
      }
    });
  });
};

const tagsOf = (clause: PMNode): string[] => clause.attrs.tags ?? [];
export const fingerprint = (clause: PMNode) =>
  JSON.stringify({ tags: tagsOf(clause), content: clause.content.toJSON() });

// What the backend has, as of the last load or save.
export interface Baseline {
  clauses: Map<string, { fingerprint: string; containerKey: string }>;
  // Containers that exist on the backend (their titles can't be renamed).
  containers: Set<string>;
}

export const captureBaseline = (doc: PMNode): Baseline => {
  const clauses: Baseline["clauses"] = new Map();
  forEachClause(doc, ({ node, ctx }) => {
    if (node.attrs.id && !isTempClauseId(node.attrs.id)) {
      clauses.set(node.attrs.id, { fingerprint: fingerprint(node), containerKey: ctx.containerKey });
    }
  });
  const containers = new Set<string>();
  forEachContainer(doc, ({ key }) => containers.add(key));
  return { clauses, containers };
};

export interface AddedClause {
  // The clause's current id in the editor (temp id, or the old backend id of
  // a clause that was moved to another container).
  editorId: string;
  node: PMNode;
  ctx: ClauseContext;
}

export interface Changes {
  added: AddedClause[];
  updated: { id: string; node: PMNode }[];
  deleted: string[];
  // Saved clauses found in another container (in `deleted` and `added`).
  // The editor blocks moves, so this only happens with unexpected input.
  moved: Set<string>;
}

export const computeChanges = (doc: PMNode, baseline: Baseline): Changes => {
  const added: Changes["added"] = [];
  const updated: Changes["updated"] = [];
  const deleted: string[] = [];
  const moved = new Set<string>();
  const seen = new Set<string>();

  forEachClause(doc, ({ node, ctx }) => {
    const id: string | null = node.attrs.id;
    const base = id ? baseline.clauses.get(id) : undefined;
    if (!id || !base || seen.has(id)) {
      added.push({ editorId: id ?? "", node, ctx });
      return;
    }
    seen.add(id);
    // The backend can't move a clause: a moved clause is deleted and re-added.
    if (base.containerKey !== ctx.containerKey) {
      moved.add(id);
      deleted.push(id);
      added.push({ editorId: id, node, ctx });
    } else if (base.fingerprint !== fingerprint(node)) {
      updated.push({ id, node });
    }
  });
  for (const id of baseline.clauses.keys()) {
    if (!seen.has(id)) deleted.push(id);
  }
  return { added, updated, deleted, moved };
};

export const changeCount = (changes: Changes) =>
  changes.added.length + changes.updated.length + changes.deleted.length;

export const clauseJSON = (node: PMNode): ClauseNodeJSON => ({
  type: "clause",
  attrs: { tags: tagsOf(node) },
  content: node.content.toJSON() ?? [],
});

const headingJSON = (level: 2 | 3, text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

export interface AppendRequest {
  body: KbDocument;
  // In the order the clauses appear in `body`, i.e. the order of the
  // response's `clause_ids`.
  clauses: AddedClause[];
  // Request path of each clause node (e.g. `doc.content[0].content[3]`),
  // used to map validation errors back to clauses.
  paths: string[];
}

// Builds append requests in the document shape, at most `maxClauses` clauses each.
export const buildAppendRequests = (
  docType: DocType,
  entityId: string,
  added: AddedClause[],
  maxClauses: number,
): AppendRequest[] => {
  const requests: AppendRequest[] = [];
  for (let start = 0; start < added.length; start += maxClauses) {
    const chunk = added.slice(start, start + maxClauses);
    const clauses: AddedClause[] = [];
    const paths: string[] = [];
    const sectionContent: JSONContent[] = [];
    const sectionPath = "doc.content[0]";

    for (const c of chunk.filter((c) => !c.ctx.subSection)) {
      paths.push(`${sectionPath}.content[${sectionContent.length}]`);
      clauses.push(c);
      sectionContent.push(clauseJSON(c.node));
    }

    const subKeys = [...new Set(chunk.filter((c) => c.ctx.subSection).map((c) => c.ctx.containerKey.split("/wf:")[0]))];
    for (const subKey of subKeys) {
      const inSub = chunk.filter((c) => c.ctx.subSection && c.ctx.containerKey.split("/wf:")[0] === subKey);
      const { type, id, name } = inSub[0].ctx.subSection!;
      const subPath = `${sectionPath}.content[${sectionContent.length}]`;
      const subContent: JSONContent[] = [];

      for (const c of inSub.filter((c) => !c.ctx.workflow)) {
        paths.push(`${subPath}.content[${subContent.length}]`);
        clauses.push(c);
        subContent.push(clauseJSON(c.node));
      }
      const wfKeys = [...new Set(inSub.filter((c) => c.ctx.workflow).map((c) => c.ctx.containerKey))];
      for (const wfKey of wfKeys) {
        const inWf = inSub.filter((c) => c.ctx.containerKey === wfKey);
        const { id: wfId, title } = inWf[0].ctx.workflow!;
        const wfPath = `${subPath}.content[${subContent.length}]`;
        const wfContent: JSONContent[] = [headingJSON(3, title)];
        for (const c of inWf) {
          paths.push(`${wfPath}.content[${wfContent.length}]`);
          clauses.push(c);
          wfContent.push(clauseJSON(c.node));
        }
        subContent.push({ type: "workflow", attrs: { id: wfId }, content: wfContent });
      }
      sectionContent.push({ type: "subSection", attrs: { type, id, name }, content: subContent });
    }

    requests.push({
      body: {
        type: docType,
        doc: { type: "doc", content: [{ type: "section", attrs: { id: entityId }, content: sectionContent }] },
      },
      clauses,
      paths,
    });
  }
  return requests;
};

// Body of a single add for one new clause.
export const addClauseBody = (docType: DocType, entityId: string, c: AddedClause): AddClauseBody => ({
  type: docType,
  entity_id: entityId,
  ...(c.ctx.subSection && { sub_section: { ...c.ctx.subSection } }),
  ...(c.ctx.workflow && { workflow: { id: c.ctx.workflow.id, heading: c.ctx.workflow.title } }),
  clause: clauseJSON(c.node),
});

export type AddRequest =
  | { kind: "single"; body: AddClauseBody; clauses: [AddedClause] }
  | ({ kind: "append" } & AppendRequest);

// How new clauses are sent: one new clause → single add
// (POST /knowledge-base/clauses); several → append, at most `maxClauses` each.
export const planAddRequests = (
  docType: DocType,
  entityId: string,
  added: AddedClause[],
  maxClauses: number,
): AddRequest[] => {
  if (added.length === 0) return [];
  if (added.length === 1) {
    return [{ kind: "single", body: addClauseBody(docType, entityId, added[0]), clauses: [added[0]] }];
  }
  return buildAppendRequests(docType, entityId, added, maxClauses).map((r) => ({ kind: "append", ...r }));
};

// Maps validation errors to the clauses they refer to (by longest path prefix).
// Errors that don't point inside a clause are returned under `general`.
export const mapFieldErrors = (errors: FieldError[], paths: string[]) => {
  const byIndex = new Map<number, string[]>();
  const general: string[] = [];
  for (const err of errors) {
    let best = -1;
    paths.forEach((path, i) => {
      const matches = err.field === path || err.field.startsWith(`${path}.`);
      if (matches && (best < 0 || path.length > paths[best].length)) best = i;
    });
    const message = `${err.field}: ${err.message}`;
    if (best < 0) general.push(message);
    else byIndex.set(best, [...(byIndex.get(best) ?? []), message]);
  }
  return { byIndex, general };
};

// New subSections or workflows without clauses wouldn't be stored by the backend.
export const findEmptyNewContainers = (doc: PMNode, baseline: Baseline): string[] => {
  const problems: string[] = [];
  forEachContainer(doc, ({ node, key }) => {
    if (node.type.name === "section" || baseline.containers.has(key)) return;
    let clauses = 0;
    node.descendants((n) => {
      if (n.type.name === "clause") clauses++;
      return n.type.name !== "clause";
    });
    if (clauses === 0) {
      const label = node.type.name === "workflow" ? "workflow" : "subsection";
      problems.push(`The new ${label} "${titleOf(node) || node.attrs.id}" has no clauses. Add one or delete it.`);
    }
  });
  return problems;
};

// Container keys that hold at least one saved clause (they now exist on the
// backend), including their ancestors.
export const containersWithSavedClauses = (doc: PMNode, baseline: Baseline): Set<string> => {
  const keys = new Set<string>();
  forEachClause(doc, ({ node, ctx }) => {
    if (!baseline.clauses.has(node.attrs.id)) return;
    const parts = ctx.containerKey.split("/");
    parts.forEach((_, i) => keys.add(parts.slice(0, i + 1).join("/")));
  });
  return keys;
};

// Request path of every clause when the editor document is sent as-is (create).
export const clausePathsInDoc = (doc: PMNode): { path: string; id: string }[] => {
  const out: { path: string; id: string }[] = [];
  const walk = (node: PMNode, path: string) => {
    node.forEach((child, _offset, index) => {
      const childPath = `${path}.content[${index}]`;
      if (child.type.name === "clause") out.push({ path: childPath, id: child.attrs.id });
      else if (!child.isTextblock) walk(child, childPath);
    });
  };
  walk(doc, "doc");
  return out;
};

// Where a new clause goes in a container: after its last clause (or its
// title), before child containers. Matches where the backend appends it.
export const clauseInsertPos = (container: PMNode, containerPos: number): number => {
  let pos = containerPos + 1;
  container.forEach((child, offset) => {
    if (child.type.name === "heading" || child.type.name === "clause") {
      pos = containerPos + 1 + offset + child.nodeSize;
    }
  });
  return pos;
};
