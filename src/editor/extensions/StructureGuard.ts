import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { SUBSECTION_TYPES, WORKFLOWS, isOneOf } from "../taxonomy";
import { REMOTE_SYNC_META } from "../scope";

// Rules the schema can't express: fixed-list values and uniqueness of
// container ids within their parent. Returns one message per problem.
export const findStructureProblems = (doc: PMNode): string[] => {
  const problems: string[] = [];
  const entities = new Set<string>();

  doc.forEach((section) => {
    const vertical = section.attrs.id ? String(section.attrs.id).trim() : "";
    if (!vertical) {
      problems.push("The document has no entity id.");
    } else if (vertical.length > 100) {
      problems.push(`Entity id "${vertical}" is longer than 100 characters.`);
    } else if (entities.has(vertical)) {
      problems.push(`Entity "${vertical}" appears more than once.`);
    } else {
      entities.add(vertical);
    }

    const subKeys = new Set<string>();
    section.forEach((sub) => {
      if (sub.type.name !== "subSection") return;
      const { type } = sub.attrs;
      const id = sub.attrs.id ? String(sub.attrs.id).trim() : "";
      const label = `${type ?? "?"} "${id}"`;
      if (!isOneOf(SUBSECTION_TYPES, type)) {
        problems.push(`Subsection "${id}" in "${vertical}" has an unknown type "${type}".`);
      }
      if (!id) {
        problems.push(`A ${type ?? ""} subsection in "${vertical}" has no id.`);
      } else if (id.length > 100) {
        problems.push(`Subsection id "${id}" is longer than 100 characters.`);
      } else if (subKeys.has(`${type}:${id}`)) {
        problems.push(`Subsection ${label} appears more than once in "${vertical}".`);
      } else {
        subKeys.add(`${type}:${id}`);
      }

      const workflows = new Set<string>();
      sub.forEach((wf) => {
        if (wf.type.name !== "workflow") return;
        const wfId = wf.attrs.id;
        if (!isOneOf(WORKFLOWS, wfId)) {
          problems.push(`A workflow in ${label} has an unknown id "${wfId}".`);
        } else if (workflows.has(wfId)) {
          problems.push(`Workflow "${wfId}" appears more than once in ${label}.`);
        } else {
          workflows.add(wfId);
        }
      });
    });
  });

  return problems;
};

// Everything that must hold before saving: structure rules, non-empty titles
// and non-empty clauses (the backend rejects clauses without content).
export const findSaveProblems = (doc: PMNode): string[] => {
  const problems = findStructureProblems(doc);
  let emptyClauses = 0;
  doc.descendants((node) => {
    if (node.type.name === "clause") {
      if (!node.textContent.trim()) emptyClauses++;
      return false;
    }
    if (["section", "subSection", "workflow"].includes(node.type.name)) {
      if (!node.firstChild?.textContent.trim()) {
        problems.push(`The ${node.type.name} "${node.attrs.id}" needs a title.`);
      }
    }
    return true;
  });
  if (emptyClauses > 0) {
    problems.push(`${emptyClauses} clause${emptyClauses > 1 ? "s are" : " is"} empty. Add text or delete ${emptyClauses > 1 ? "them" : "it"}.`);
  }
  return problems;
};

interface StructureGuardOptions {
  onReject: ((problems: string[]) => void) | null;
}

// Rejects any transaction that introduces a new structure problem (e.g.
// pasting or drag-copying a workflow that already exists in the subsection).
// Edits to a document that already has problems are still allowed, so
// loading bad content can never lock the editor.
export const StructureGuard = Extension.create<StructureGuardOptions>({
  name: "structureGuard",

  addOptions() {
    return { onReject: null };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("structureGuard"),
        filterTransaction: (tr, state) => {
          if (!tr.docChanged || tr.getMeta(REMOTE_SYNC_META)) return true;
          // Compare as multisets so a third copy of an existing duplicate
          // still counts as a new problem.
          const remaining = new Map<string, number>();
          for (const p of findStructureProblems(state.doc)) {
            remaining.set(p, (remaining.get(p) ?? 0) + 1);
          }
          const introduced = findStructureProblems(tr.doc).filter((p) => {
            const left = remaining.get(p) ?? 0;
            if (left === 0) return true;
            remaining.set(p, left - 1);
            return false;
          });
          if (introduced.length === 0) return true;
          this.options.onReject?.(introduced);
          return false;
        },
      }),
    ];
  },
});
