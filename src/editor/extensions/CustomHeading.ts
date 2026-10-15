import { Heading } from "@tiptap/extension-heading";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Level } from "@tiptap/extension-heading";
import { generateTempClauseId } from "../utils/ids";

interface CustomHeadingOptions {
  // If provided, the host app handles clause creation (e.g., to prompt for
  // tags) at the given position. Returning `true` from this callback means
  // the extension will NOT insert a clause itself.
  onRequestClauseAt: ((pos: number) => boolean | void) | null;
}

// Heading level is derived from the container it titles, never chosen.
const LEVEL_BY_CONTAINER: Record<string, Level> = {
  section: 1,
  subSection: 2,
  workflow: 3,
};

// The heading is only the title of a Section / SubSection / Workflow. It is
// moved out of the `block` group so it can't appear inside clauses (or lists
// and blockquotes within them).
//
// Pressing Enter inside a heading should not split it (each container
// requires exactly one heading). Instead, the host can intercept the event
// and create a clause after the heading.
export const CustomHeading = Heading.extend<CustomHeadingOptions>({
  group: "title",

  addOptions() {
    return {
      ...this.parent?.(),
      levels: [1, 2, 3],
      HTMLAttributes: {},
      onRequestClauseAt: null,
    };
  },

  // Markdown shortcuts like "# " would try to create headings in clauses.
  addInputRules() {
    return [];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("headingLevelSync"),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const tr = newState.tr;
          newState.doc.descendants((node, pos, parent) => {
            if (node.type.name !== this.name) return true;
            const level = parent ? LEVEL_BY_CONTAINER[parent.type.name] : undefined;
            if (level && node.attrs.level !== level) {
              tr.setNodeAttribute(pos, "level", level);
            }
            return false;
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        if (!editor.isActive("heading")) return false;

        const { $from } = editor.state.selection;

        let headingDepth = -1;
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.name === "heading") {
            headingDepth = d;
            break;
          }
        }
        if (headingDepth < 0) return false;

        const insertPos = $from.after(headingDepth);

        // Defer to host (e.g., to open a tag dialog).
        const handled = this.options.onRequestClauseAt?.(insertPos);
        if (handled !== false) return true;

        // Fallback: insert a default clause with empty tags.
        return editor
          .chain()
          .insertContentAt(insertPos, {
            type: "clause",
            attrs: { id: generateTempClauseId(), tags: [] },
            content: [{ type: "paragraph" }],
          })
          .setTextSelection(insertPos + 2)
          .focus()
          .run();
      },
    };
  },
});
