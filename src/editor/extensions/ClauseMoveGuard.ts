import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { REMOTE_SYNC_META } from "../scope";
import { forEachClause, type Baseline } from "../sync/changes";

interface ClauseMoveGuardOptions {
  getBaseline: (() => Baseline) | null;
  onReject: ((message: string) => void) | null;
}

// Saved clauses that sit somewhere other than where the backend has them:
// `move:<id>` for one in another container, `order:<container>` for a
// container whose saved clauses are out of the backend's order.
const misplaced = (doc: PMNode, baseline: Baseline): Set<string> => {
  const found = new Set<string>();
  // Saved clauses in document order. A copy briefly shares the original's id
  // (the clause id plugin gives it a temp id right after), so an id that
  // still occurs in its saved container isn't moved, and ids that occur more
  // than once are left out of the order check.
  const seen: { id: string; key: string }[] = [];
  forEachClause(doc, ({ node, ctx }) => {
    if (baseline.clauses.has(node.attrs.id)) seen.push({ id: node.attrs.id, key: ctx.containerKey });
  });
  const count = new Map<string, number>();
  for (const { id } of seen) count.set(id, (count.get(id) ?? 0) + 1);
  for (const { id } of seen) {
    const savedKey = baseline.clauses.get(id)!.containerKey;
    if (!seen.some((o) => o.id === id && o.key === savedKey)) found.add(`move:${id}`);
  }
  const order = new Map<string, string[]>();
  for (const { id, key } of seen) {
    if (count.get(id) === 1) order.set(key, [...(order.get(key) ?? []), id]);
  }
  // Baseline entries are in the backend's order.
  const expected = new Map<string, string[]>();
  for (const [id, { containerKey }] of baseline.clauses) {
    expected.set(containerKey, [...(expected.get(containerKey) ?? []), id]);
  }
  for (const [key, ids] of order) {
    const want = (expected.get(key) ?? []).filter((id) => ids.includes(id));
    if (want.join() !== ids.filter((id) => want.includes(id)).join()) found.add(`order:${key}`);
  }
  return found;
};

// The backend can't move or reorder clauses, so saved clauses stay where the
// backend has them: a change that puts one in another container, or changes
// the order of saved clauses within a container (in one step, or by cutting
// and pasting), is rejected. Copies are fine: they become new clauses.
export const ClauseMoveGuard = Extension.create<ClauseMoveGuardOptions>({
  name: "clauseMoveGuard",

  addOptions() {
    return { getBaseline: null, onReject: null };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("clauseMoveGuard"),
        filterTransaction: (tr, state) => {
          if (!tr.docChanged || tr.getMeta(REMOTE_SYNC_META)) return true;
          const baseline = this.options.getBaseline?.();
          if (!baseline || baseline.clauses.size === 0) return true;

          // Only new problems are rejected, so a document that already has one
          // (e.g. after a partial save) can still be edited.
          const before = misplaced(state.doc, baseline);
          const added = [...misplaced(tr.doc, baseline)].filter((p) => !before.has(p));
          if (added.length === 0) return true;
          this.options.onReject?.(
            added.some((p) => p.startsWith("move:"))
              ? "Saved clauses can't be moved to another subsection or workflow. Copy the text into a new clause there, then delete the original."
              : "Saved clauses can't be reordered yet. New clauses are always added at the end.",
          );
          return false;
        },
      }),
    ];
  },
});
