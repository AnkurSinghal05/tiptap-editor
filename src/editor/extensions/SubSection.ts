import { Plugin, PluginKey } from "@tiptap/pm/state";
import { confirmDeleteContainer, createContainerNode } from "./createContainerNode";
import { SUBSECTION_TYPES, isOneOf, type SubSectionType } from "../taxonomy";

export interface SubSectionAttrs {
  type: SubSectionType | null;
  id: string | null;
  name: string;
}

// SubSection = a facility, partner or service within a vertical. `type` and
// `id` (the real-world entity id) are set when it is created; `name` always
// mirrors the heading text so the title is edited in place.
// Only valid inside a Section.
export const SubSection = createContainerNode({
  name: "subSection",
  content: "heading clause* workflow*",
  label: "subsection",
  deleteConfirmation: (node) => confirmDeleteContainer(node),
  extraAttributes: {
    type: {
      default: null,
      parseHTML: (el) => {
        const raw = el.getAttribute("data-subsection-type");
        return isOneOf(SUBSECTION_TYPES, raw) ? raw : null;
      },
      renderHTML: (attrs) => ({ "data-subsection-type": attrs.type }),
    },
    name: {
      default: "",
      parseHTML: (el) => el.getAttribute("data-subsection-name") ?? "",
      renderHTML: (attrs) => ({ "data-subsection-name": attrs.name }),
    },
  },
  badgePrefix: (node) => node.attrs.type,
}).extend({
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("subSectionName"),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const tr = newState.tr;
          newState.doc.descendants((node, pos) => {
            if (node.type.name !== this.name) return node.type.name === "section";
            const title = node.firstChild?.textContent ?? "";
            if (node.attrs.name !== title) tr.setNodeAttribute(pos, "name", title);
            return false;
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
