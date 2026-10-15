import type { Node as PMNode } from "@tiptap/pm/model";
import { KbApiError, type KbApi } from "../../api/kb/client";
import { MAX_CLAUSES_PER_REQUEST } from "../../api/kb/config";
import type { DocType } from "../../api/kb/types";
import {
  clauseJSON,
  clausePathsInDoc,
  computeChanges,
  fingerprint,
  mapFieldErrors,
  planAddRequests,
  type Baseline,
} from "./changes";

export interface SaveOutcome {
  // Editor clause id → backend clause id, for clauses the save created.
  idSwaps: Map<string, string>;
  // Editor clause id → why its change failed.
  clauseErrors: Map<string, string[]>;
  // Failures that can't be pinned to a clause in the editor.
  general: string[];
  // An append got no response: it may or may not have been saved, and
  // retrying could duplicate clauses. The scope must be reloaded first.
  uncertain: boolean;
  failed: number;
  // The baseline after the changes that succeeded.
  baseline: Baseline;
}

const describe = (err: unknown) => {
  if (err instanceof KbApiError) {
    return err.fieldErrors.length > 0 ? err.fieldErrors.map((e) => `${e.field}: ${e.message}`) : [err.message];
  }
  return [err instanceof Error ? err.message : String(err)];
};

const addError = (map: Map<string, string[]>, id: string, messages: string[]) =>
  map.set(id, [...(map.get(id) ?? []), ...messages]);

// Saves the edits to an existing document: new clauses first (a single add
// for one, append for several), then one PATCH per edited clause and one
// DELETE per removed clause. Keeps
// going after a failure (except an append without a response) and reports
// what failed.
export const saveChanges = async (
  api: KbApi,
  docType: DocType,
  entityId: string,
  doc: PMNode,
  baselineIn: Baseline,
): Promise<SaveOutcome> => {
  const baseline: Baseline = { clauses: new Map(baselineIn.clauses), containers: new Set(baselineIn.containers) };
  const changes = computeChanges(doc, baseline);
  const outcome: SaveOutcome = {
    idSwaps: new Map(),
    clauseErrors: new Map(),
    general: [],
    uncertain: false,
    failed: 0,
    baseline,
  };

  for (const req of planAddRequests(docType, entityId, changes.added, MAX_CLAUSES_PER_REQUEST)) {
    try {
      const ids =
        (req.kind === "single" ? await api.addClause(req.body) : await api.append(req.body)).clause_ids;
      req.clauses.forEach((c, i) => {
        const newId = ids[i];
        if (!newId) return;
        outcome.idSwaps.set(c.editorId, newId);
        baseline.clauses.set(newId, { fingerprint: fingerprint(c.node), containerKey: c.ctx.containerKey });
      });
    } catch (err) {
      outcome.failed += req.clauses.length;
      if (err instanceof KbApiError && err.status === 0) {
        outcome.uncertain = true;
        outcome.general.push(
          req.clauses.length > 1
            ? "No response when adding new clauses, so they may or may not have been saved. Reload before saving again, otherwise they could be added twice."
            : "No response when adding the new clause, so it may or may not have been saved. Reload before saving again, otherwise it could be added twice.",
        );
        return outcome;
      }
      if (err instanceof KbApiError && err.fieldErrors.length > 0 && req.kind === "append") {
        const { byIndex, general } = mapFieldErrors(err.fieldErrors, req.paths);
        byIndex.forEach((messages, i) => addError(outcome.clauseErrors, req.clauses[i].editorId, messages));
        outcome.general.push(...general);
      } else {
        // A single add's errors are all about its one clause.
        const messages = describe(err);
        req.clauses.forEach((c) => addError(outcome.clauseErrors, c.editorId, messages));
      }
    }
  }

  for (const { id, node } of changes.updated) {
    try {
      await api.updateClause(id, { type: docType, entity_id: entityId, clause: clauseJSON(node) });
      baseline.clauses.set(id, { ...baseline.clauses.get(id)!, fingerprint: fingerprint(node) });
    } catch (err) {
      outcome.failed++;
      addError(outcome.clauseErrors, id, describe(err));
    }
  }

  for (const id of changes.deleted) {
    // A moved clause is only deleted once its copy in the new place is saved.
    if (changes.moved.has(id) && !outcome.idSwaps.has(id)) continue;
    try {
      await api.deleteClause(id, docType, entityId);
      baseline.clauses.delete(id);
    } catch (err) {
      // Already gone on the backend: nothing left to do.
      if (err instanceof KbApiError && err.status === 404) {
        baseline.clauses.delete(id);
        continue;
      }
      outcome.failed++;
      outcome.general.push(`Couldn't delete clause ${id}: ${describe(err).join("; ")}`);
    }
  }

  return outcome;
};

export interface CreateOutcome {
  ok: boolean;
  clauseErrors: Map<string, string[]>;
  general: string[];
}

// Creates a new document (base program only) from the editor's content.
export const createDocument = async (api: KbApi, docType: DocType, doc: PMNode): Promise<CreateOutcome> => {
  const outcome: CreateOutcome = { ok: false, clauseErrors: new Map(), general: [] };
  try {
    await api.createDocument({ type: docType, doc: doc.toJSON() });
    outcome.ok = true;
  } catch (err) {
    if (err instanceof KbApiError && err.fieldErrors.length > 0) {
      const clauses = clausePathsInDoc(doc);
      const { byIndex, general } = mapFieldErrors(err.fieldErrors, clauses.map((c) => c.path));
      byIndex.forEach((messages, i) => addError(outcome.clauseErrors, clauses[i].id, messages));
      outcome.general.push(...general);
    } else if (err instanceof KbApiError && err.status === 409) {
      outcome.general.push("A document of this type already exists for this entity. Load it instead.");
    } else {
      outcome.general.push(...describe(err));
    }
  }
  return outcome;
};
