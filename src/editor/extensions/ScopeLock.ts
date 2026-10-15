import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { REMOTE_SYNC_META, findScopeNode, type Scope } from "../scope";

interface ScopeLockOptions {
  getScope: (() => Scope | null) | null;
}

// When a narrower scope is loaded (a subsection or a workflow), its ancestors
// are only shown for context: their titles are read-only and any change
// outside the scope root is rejected. The scope root itself can't be deleted
// or moved, because a save only replaces what is inside it.
export const ScopeLock = Extension.create<ScopeLockOptions>({
  name: "scopeLock",

  addOptions() {
    return { getScope: null };
  },

  addProseMirrorPlugins() {
    const getScope = () => this.options.getScope?.() ?? null;

    return [
      new Plugin({
        key: new PluginKey("scopeLock"),

        filterTransaction: (tr, state) => {
          if (!tr.docChanged || tr.getMeta(REMOTE_SYNC_META)) return true;
          const scope = getScope();
          const found = scope && findScopeNode(state.doc, scope);
          if (!found) return true;

          // Allowed range: strictly inside the scope root, tracked through each step.
          let from = found.root.pos + 1;
          let to = found.root.pos + found.root.node.nodeSize - 1;
          for (const step of tr.steps) {
            const map = step.getMap();
            let inside = true;
            map.forEach((start, end) => {
              if (start < from || end > to) inside = false;
            });
            if (!inside) return false;
            from = map.map(from, -1);
            to = map.map(to, 1);
          }
          return true;
        },

        props: {
          decorations: (state) => {
            const scope = getScope();
            const found = scope && findScopeNode(state.doc, scope);
            if (!found) return null;

            const { root, ancestors } = found;
            const decos = [Decoration.node(root.pos, root.pos + root.node.nodeSize, { class: "scope-root" })];
            for (const { node, pos } of ancestors) {
              decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "scope-ancestor" }));
              const title = node.firstChild;
              if (title) {
                decos.push(
                  Decoration.node(pos + 1, pos + 1 + title.nodeSize, {
                    class: "scope-locked-title",
                    contenteditable: "false",
                  }),
                );
              }
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
