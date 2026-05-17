import { Node, mergeAttributes } from "@tiptap/core";

export interface ClauseAttrs {
  id: string | null;
  tags: string[];
}

// Clause carries block content + (id, tags) metadata. It is only valid
// inside a Section because it's not a member of the general `block` group.
export const Clause = Node.create({
  name: "clause",

  content: "block+",

  defining: true,

  isolating: true,

  draggable: true,

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

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.classList.add("clause-node");
      if (node.attrs.id) {
        dom.setAttribute("data-clause-id", String(node.attrs.id));
      }
      dom.setAttribute("data-tags", JSON.stringify(node.attrs.tags ?? []));

      const handle = document.createElement("div");
      handle.className = "clause-drag-handle";
      handle.setAttribute("contenteditable", "false");
      handle.setAttribute("data-drag-handle", "");
      handle.setAttribute("draggable", "true");
      handle.title = "Drag to reorder clause";
      handle.textContent = "⠿";
      dom.appendChild(handle);

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
        editor
          .chain()
          .deleteRange({ from: pos, to: pos + node.nodeSize })
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
          if (updated.attrs.id) {
            dom.setAttribute("data-clause-id", String(updated.attrs.id));
          }
          return true;
        },
      };
    };
  },
});
