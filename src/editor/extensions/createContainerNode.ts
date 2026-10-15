import { Node, mergeAttributes } from "@tiptap/core";
import type { Attribute } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

// Deleting a container deletes every clause in it (the backend has no
// container delete), so ask first when it has any.
export const confirmDeleteContainer = (node: PMNode): string | null => {
  let clauses = 0;
  node.descendants((n) => {
    if (n.type.name === "clause") clauses++;
    return n.type.name !== "clause";
  });
  if (clauses === 0) return null;
  const title = node.firstChild?.textContent.trim() || node.attrs.id;
  return `Delete "${title}" and its ${clauses} clause${clauses > 1 ? "s" : ""}? This is applied when you save.`;
};

interface ContainerNodeConfig {
  name: string;
  content: string;
  // Used for the id attribute (`data-<label>-id`) and the editor badge.
  label: string;
  extraAttributes?: Record<string, Attribute>;
  // Extra text shown between the label and the id in the editor badge.
  badgePrefix?: (node: PMNode) => string | null;
  // Return a message to block deletion, or null to allow it.
  deleteBlockedReason?: (doc: PMNode) => string | null;
  // Return a question to confirm before deleting, or null to delete directly.
  deleteConfirmation?: (node: PMNode) => string | null;
}

// Section, SubSection and Workflow share the same shape: a titled container
// (heading first) with an id and a delete button. They can't be dragged: the
// backend has no way to reorder. None of them join the `block` group, so each
// can only appear where a parent's content expression names it explicitly.
export const createContainerNode = ({
  name,
  content,
  label,
  extraAttributes = {},
  badgePrefix,
  deleteBlockedReason,
  deleteConfirmation,
}: ContainerNodeConfig) => {
  const idAttr = `data-${label}-id`;

  const badgeText = (node: PMNode) => {
    const parts = [label, badgePrefix?.(node), node.attrs.id].filter(Boolean);
    return parts.join(" · ");
  };

  return Node.create({
    name,

    content,

    defining: true,

    parseHTML() {
      return [{ tag: `section[${idAttr}]` }];
    },

    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: (el) => el.getAttribute(idAttr),
          renderHTML: (attrs) => ({ [idAttr]: attrs.id }),
        },
        ...extraAttributes,
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
        dom.classList.add("container-node", `${label}-node`);
        dom.setAttribute("data-label", badgeText(node));

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "node-delete";
        deleteBtn.setAttribute("contenteditable", "false");
        deleteBtn.title = `Delete ${label}`;
        deleteBtn.textContent = "×";
        deleteBtn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos == null) return;
          const blocked = deleteBlockedReason?.(editor.state.doc);
          if (blocked) {
            window.alert(blocked);
            return;
          }
          const current = editor.state.doc.nodeAt(pos);
          if (!current) return;
          const question = deleteConfirmation?.(current);
          if (question && !window.confirm(question)) return;
          editor
            .chain()
            .deleteRange({ from: pos, to: pos + current.nodeSize })
            .focus()
            .run();
        });
        dom.appendChild(deleteBtn);

        const contentDOM = document.createElement("div");
        contentDOM.className = "container-content";
        dom.appendChild(contentDOM);

        return {
          dom,
          contentDOM,
          update(updated) {
            if (updated.type.name !== name) return false;
            dom.setAttribute("data-label", badgeText(updated));
            return true;
          },
        };
      };
    },
  });
};
