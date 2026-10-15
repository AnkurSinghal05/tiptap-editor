import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { REMOTE_SYNC_META } from "../scope";
import { forEachContainer, titleOf } from "../sync/containerKeys";

interface TitleLockOptions {
  // Keys of containers that exist on the backend (see sync/containerKeys.ts).
  getLockedKeys: (() => Set<string>) | null;
}

// The backend can't rename an entity, subSection or workflow once created,
// so the titles of saved containers are read-only. New containers keep
// editable titles until their first save. Deleting a container is still
// allowed (it deletes its clauses).
export const TitleLock = Extension.create<TitleLockOptions>({
  name: "titleLock",

  addOptions() {
    return { getLockedKeys: null };
  },

  addProseMirrorPlugins() {
    const locked = () => this.options.getLockedKeys?.() ?? new Set<string>();

    return [
      new Plugin({
        key: new PluginKey("titleLock"),

        filterTransaction: (tr, state) => {
          if (!tr.docChanged || tr.getMeta(REMOTE_SYNC_META)) return true;
          const keys = locked();
          if (keys.size === 0) return true;
          const before = new Map<string, string>();
          forEachContainer(state.doc, ({ node, key }) => keys.has(key) && before.set(key, titleOf(node)));
          let ok = true;
          forEachContainer(tr.doc, ({ node, key }) => {
            if (before.has(key) && before.get(key) !== titleOf(node)) ok = false;
          });
          return ok;
        },

        props: {
          decorations: (state) => {
            const keys = locked();
            if (keys.size === 0) return null;
            const decos: Decoration[] = [];
            forEachContainer(state.doc, ({ node, pos, key }) => {
              const title = node.firstChild;
              if (!keys.has(key) || !title) return;
              decos.push(
                Decoration.node(pos + 1, pos + 1 + title.nodeSize, {
                  class: "title-locked",
                  contenteditable: "false",
                  title: "Saved titles can't be renamed",
                }),
              );
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
