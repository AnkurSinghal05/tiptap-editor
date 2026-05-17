import { Heading } from "@tiptap/extension-heading";
import { generateClauseId } from "../utils/ids";

interface CustomHeadingOptions {
  // If provided, the host app handles clause creation (e.g., to prompt for
  // tags) at the given position. Returning `true` from this callback means
  // the extension will NOT insert a clause itself.
  onRequestClauseAt: ((pos: number) => boolean | void) | null;
}

// Pressing Enter inside a section heading should not split the heading
// (the schema requires exactly one heading per section). Instead, the
// host can intercept the event and create a clause after the heading.
export const CustomHeading = Heading.extend<CustomHeadingOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      levels: [1, 2, 3, 4, 5, 6],
      HTMLAttributes: {},
      onRequestClauseAt: null,
    };
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
            attrs: { id: generateClauseId(), tags: [] },
            content: [{ type: "paragraph" }],
          })
          .setTextSelection(insertPos + 2)
          .focus()
          .run();
      },
    };
  },
});
