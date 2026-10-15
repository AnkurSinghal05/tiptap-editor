import type { Node as PMNode } from "@tiptap/pm/model";
import { DOC_TYPES, type DocType } from "../api/kb/types";
import { SUBSECTION_TYPES, WORKFLOWS, labelOf, type SubSectionType, type WorkflowId } from "./taxonomy";

// What the editor has loaded: one entity's document of one type, optionally
// narrowed to one subsection, optionally narrowed further to one workflow.
export interface Scope {
  docType: DocType;
  entityId: string;
  subSection?: { type: SubSectionType; id: string };
  workflow?: WorkflowId;
}

// Transaction meta for changes that come from the backend (e.g. swapping in
// the clause ids from a save). They bypass the edit locks and don't count as edits.
export const REMOTE_SYNC_META = "tncRemoteSync";

export interface LocatedNode {
  node: PMNode;
  pos: number;
}

// Finds the scope's root node plus its ancestors (outermost first).
export const findScopeNode = (
  doc: PMNode,
  scope: Scope,
): { root: LocatedNode; ancestors: LocatedNode[] } | null => {
  const childOf = (parent: LocatedNode | null, match: (n: PMNode) => boolean) => {
    const container = parent ? parent.node : doc;
    const base = parent ? parent.pos + 1 : 0;
    let found: LocatedNode | null = null;
    container.forEach((node, offset) => {
      if (!found && match(node)) found = { node, pos: base + offset };
    });
    return found as LocatedNode | null;
  };

  const section = childOf(null, (n) => n.type.name === "section" && n.attrs.id === scope.entityId);
  if (!section) return null;
  if (!scope.subSection) return { root: section, ancestors: [] };

  const { type, id } = scope.subSection;
  const sub = childOf(
    section,
    (n) => n.type.name === "subSection" && n.attrs.type === type && n.attrs.id === id,
  );
  if (!sub) return null;
  if (!scope.workflow) return { root: sub, ancestors: [section] };

  const wf = childOf(sub, (n) => n.type.name === "workflow" && n.attrs.id === scope.workflow);
  if (!wf) return null;
  return { root: wf, ancestors: [section, sub] };
};

// True when `pos` lies inside the scope root's content (where edits are allowed).
export const isPosInScope = (doc: PMNode, scope: Scope, pos: number) => {
  const found = findScopeNode(doc, scope);
  if (!found) return false;
  const { node, pos: start } = found.root;
  return pos > start && pos < start + node.nodeSize;
};

export const describeScope = (scope: Scope, entityTitle?: string) => {
  const parts: string[] = [labelOf(DOC_TYPES, scope.docType), entityTitle || scope.entityId];
  if (scope.subSection) {
    parts.push(`${labelOf(SUBSECTION_TYPES, scope.subSection.type)} ${scope.subSection.id}`);
  }
  if (scope.workflow) parts.push(labelOf(WORKFLOWS, scope.workflow));
  return parts;
};
