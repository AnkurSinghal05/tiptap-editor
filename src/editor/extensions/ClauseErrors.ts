import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface ClauseErrorsOptions {
  // clause id → error messages from the last save.
  getErrors: (() => Map<string, string[]>) | null;
}

export const CLAUSE_ERRORS_REFRESH_META = "clauseErrorsRefresh";

// Highlights clauses whose last save failed, with the reason as a tooltip.
// Dispatch a transaction with CLAUSE_ERRORS_REFRESH_META after the errors change.
export const ClauseErrors = Extension.create<ClauseErrorsOptions>({
  name: "clauseErrors",

  addOptions() {
    return { getErrors: null };
  },

  addProseMirrorPlugins() {
    const errors = () => this.options.getErrors?.() ?? new Map<string, string[]>();

    return [
      new Plugin({
        key: new PluginKey("clauseErrors"),
        props: {
          decorations: (state) => {
            const map = errors();
            if (map.size === 0) return null;
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "clause") return true;
              const messages = map.get(node.attrs.id);
              if (messages) {
                decos.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: "clause-node--error",
                    title: messages.join("\n"),
                  }),
                );
              }
              return false;
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
