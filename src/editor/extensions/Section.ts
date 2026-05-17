import { Node, mergeAttributes } from "@tiptap/core";

export interface SectionAttrs {
  id: string | null;
}

// Section is a root-only node. The schema does NOT include `group: "block"`,
// which means the section can only appear where the schema explicitly allows
// it — i.e. as a direct child of the document. Sections therefore can never
// be nested inside other sections or clauses.
export const Section = Node.create({
  name: "section",

  content: "heading clause*",

  defining: true,

  draggable: true,

  parseHTML() {
    return [{ tag: "section[data-section-id]" }];
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-section-id"),
        renderHTML: (attrs) => ({ "data-section-id": attrs.id }),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return ["section", mergeAttributes(HTMLAttributes), 0];
  },

  // NodeView only affects the in-editor DOM (not `getHTML()` output), so the
  // Render panel still serializes a clean `<section>` without editor chrome.
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("section");
      dom.classList.add("section-node");
      if (node.attrs.id) {
        dom.setAttribute("data-section-id", String(node.attrs.id));
      }

      const handle = document.createElement("div");
      handle.className = "section-drag-handle";
      handle.setAttribute("contenteditable", "false");
      handle.setAttribute("data-drag-handle", "");
      handle.setAttribute("draggable", "true");
      handle.title = "Drag to reorder section";
      handle.textContent = "⠿";
      dom.appendChild(handle);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "node-delete";
      deleteBtn.setAttribute("contenteditable", "false");
      deleteBtn.title = "Delete section";
      deleteBtn.textContent = "×";
      deleteBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos == null) return;
        if (editor.state.doc.childCount <= 1) {
          window.alert("Document must contain at least one section.");
          return;
        }
        editor
          .chain()
          .deleteRange({ from: pos, to: pos + node.nodeSize })
          .focus()
          .run();
      });
      dom.appendChild(deleteBtn);

      const contentDOM = document.createElement("div");
      contentDOM.className = "section-content";
      dom.appendChild(contentDOM);

      return { dom, contentDOM };
    };
  },
});
