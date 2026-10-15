import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { generateTempClauseId, isTempClauseId } from "../utils/ids";

export interface ClauseAttrs {
  // Backend clause id, or a `tmp-…` id until the clause is first saved.
  id: string | null;
  tags: string[];
}

interface ClauseOptions {
  // Returns the backend id already assigned to a temp id in this session.
  // Lets redo/paste of a just-saved clause pick up its real id again.
  resolveTempId: ((tempId: string) => string | undefined) | null;
  // True for backend ids that belong to the loaded scope (loaded or assigned
  // by a save). A backend id from elsewhere (pasted from another scope or tab)
  // is treated as a new clause and gets a temp id.
  isKnownId: ((id: string) => boolean) | null;
}

const CONTAINERS = new Set(["doc", "section", "subSection", "workflow"]);

const forEachClause = (doc: PMNode, fn: (node: PMNode, pos: number) => void) => {
  doc.descendants((node, pos) => {
    if (node.type.name === "clause") {
      fn(node, pos);
      return false;
    }
    return CONTAINERS.has(node.type.name);
  });
};

// Clause carries block content + (id, tags) metadata. It is only valid
// inside a container because it's not a member of the general `block` group.
export const Clause = Node.create<ClauseOptions>({
  name: "clause",

  addOptions() {
    return { resolveTempId: null, isKnownId: null };
  },

  content: "block+",

  defining: true,

  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-clause-id]" }];
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-clause-id"),
        renderHTML: (attrs) => ({ "data-clause-id": attrs.id }),
      },
      tags: {
        default: [] as string[],
        parseHTML: (el) => {
          const raw = el.getAttribute("data-tags");
          if (!raw) return [];
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
          } catch {
            return [];
          }
        },
        renderHTML: (attrs) => ({ "data-tags": JSON.stringify(attrs.tags ?? []) }),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },

  // Every clause must have a unique id. Copy/paste and drag-copy can produce
  // missing or duplicate ids; this repairs them. When a clause is duplicated,
  // the one that already existed keeps its id and the copy gets a new temp id
  // (a copy is a new clause for the backend), wherever it was inserted.
  // A temp id the backend has already mapped is swapped for the real id, and a
  // backend id foreign to the loaded scope is replaced with a temp id.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("clauseIds"),
        appendTransaction: (transactions, oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const mapping = new Mapping();
          transactions.forEach((tr) => tr.mapping.maps.forEach((map) => mapping.appendMap(map)));

          // Where each pre-existing clause id lives now (if it survived).
          const ownerPos = new Map<string, number>();
          forEachClause(oldState.doc, (node, pos) => {
            if (!node.attrs.id) return;
            const mapped = mapping.map(pos, 1);
            const now = newState.doc.nodeAt(mapped);
            if (now?.type.name === "clause" && now.attrs.id === node.attrs.id) {
              ownerPos.set(node.attrs.id, mapped);
            }
          });

          const allIds = new Set<string>();
          forEachClause(newState.doc, (node) => node.attrs.id && allIds.add(node.attrs.id));

          const tr = newState.tr;
          const seen = new Set<string>();
          forEachClause(newState.doc, (node, pos) => {
            let id: string | null = node.attrs.id;
            const resolved = isTempClauseId(id) ? this.options.resolveTempId?.(id) : undefined;
            if (resolved && !allIds.has(resolved)) {
              tr.setNodeAttribute(pos, "id", resolved);
              allIds.add(resolved);
              id = resolved;
            }
            const owner = id ? ownerPos.get(id) : undefined;
            const foreign = !!id && !isTempClauseId(id) && this.options.isKnownId?.(id) === false;
            if (id && !foreign && !seen.has(id) && (owner === undefined || owner === pos)) {
              seen.add(id);
              return;
            }
            const fresh = generateTempClauseId();
            allIds.add(fresh);
            seen.add(fresh);
            tr.setNodeAttribute(pos, "id", fresh);
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.classList.add("clause-node");
      dom.classList.toggle("clause-node--temp", isTempClauseId(node.attrs.id));
      if (node.attrs.id) {
        dom.setAttribute("data-clause-id", String(node.attrs.id));
      }
      dom.setAttribute("data-tags", JSON.stringify(node.attrs.tags ?? []));

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "node-delete";
      deleteBtn.setAttribute("contenteditable", "false");
      deleteBtn.title = "Delete clause";
      deleteBtn.textContent = "×";
      deleteBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos == null) return;
        const current = editor.state.doc.nodeAt(pos);
        if (!current) return;
        editor
          .chain()
          .deleteRange({ from: pos, to: pos + current.nodeSize })
          .focus()
          .run();
      });
      dom.appendChild(deleteBtn);

      const contentDOM = document.createElement("div");
      contentDOM.className = "clause-content";
      dom.appendChild(contentDOM);

      return {
        dom,
        contentDOM,
        update(updated) {
          if (updated.type.name !== "clause") return false;
          // Keep data-tags in sync when the tags attr changes.
          dom.setAttribute("data-tags", JSON.stringify(updated.attrs.tags ?? []));
          dom.classList.toggle("clause-node--temp", isTempClauseId(updated.attrs.id));
          if (updated.attrs.id) {
            dom.setAttribute("data-clause-id", String(updated.attrs.id));
          }
          return true;
        },
      };
    };
  },
});
