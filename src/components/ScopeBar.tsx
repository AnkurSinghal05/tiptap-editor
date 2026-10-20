import { useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { kbApi } from "../api/kb";
import { KbApiError } from "../api/kb/client";
import { DOC_TYPES, type DocType, type KbDocument } from "../api/kb/types";
import type { Scope } from "../editor/scope";
import {
  ENTITIES,
  SUBSECTION_TYPES,
  WORKFLOWS,
  labelOf,
  type EntityId,
  type SubSectionType,
  type WorkflowId,
} from "../editor/taxonomy";

// A new object refreshes what the scope bar knows about the chosen entity
// (whether it has a document, and its subsections): from `document` (an
// entity's whole document, just loaded from the backend) when it's for the
// chosen entity, otherwise by fetching it.
export interface SubSectionsRefresh {
  document?: KbDocument;
}

interface ScopeBarProps {
  loading: boolean;
  subSectionsRefresh: SubSectionsRefresh;
  onLoad: (scope: Scope) => void;
  onCreate: (docType: DocType, entityId: string, title: string) => void;
}

interface SubSectionOption {
  type: SubSectionType;
  id: string;
  name: string;
  workflows: WorkflowId[];
}

const textOf = (n: JSONContent | undefined): string =>
  !n ? "" : n.text ?? (n.content ?? []).map(textOf).join("");
const sectionOf = (d: KbDocument) => d.doc.content?.[0];
const subKey = (s: { type: string; id: string }) => `${s.type}:${s.id}`;

const subSectionsOf = (d: KbDocument | undefined): SubSectionOption[] =>
  ((d && sectionOf(d)?.content) ?? [])
    .filter((n) => n.type === "subSection")
    .map((n) => ({
      type: n.attrs!.type as SubSectionType,
      id: n.attrs!.id as string,
      name: (n.attrs!.name as string) || textOf(n.content?.[0]),
      workflows: (n.content ?? []).filter((w) => w.type === "workflow").map((w) => w.attrs!.id as WorkflowId),
    }));

// Filters for what to load: document type and entity (required) →
// subsection (optional) → workflow (optional, only once a subsection is chosen).
// Entities come from a fixed list; one without a document of the chosen type
// offers to start one instead.
export const ScopeBar = ({ loading, subSectionsRefresh, onLoad, onCreate }: ScopeBarProps) => {
  const [docType, setDocType] = useState<DocType>(DOC_TYPES[0].value);
  const [entityId, setEntityId] = useState<EntityId | "">("");
  // null until known (no entity chosen, still fetching, or the fetch failed).
  const [hasDocument, setHasDocument] = useState<boolean | null>(null);
  const [subSections, setSubSections] = useState<SubSectionOption[]>([]);
  const [selectedSub, setSelectedSub] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowId | "">("");
  const [error, setError] = useState<string | null>(null);

  // The chosen entity's document: whether it exists, and its subsections
  // (and their workflows).
  useEffect(() => {
    setError(null);
    setHasDocument(null);
    setSubSections([]);
    if (!entityId) return;
    const show = (d: KbDocument | undefined) => {
      const subs = subSectionsOf(d);
      setHasDocument(!!d);
      setSubSections(subs);
      setSelectedSub((current) => (subs.some((s) => subKey(s) === current) ? current : ""));
    };
    // The editor just loaded this entity: no need to fetch it again.
    const loaded = subSectionsRefresh.document;
    if (loaded && loaded.type === docType && sectionOf(loaded)?.attrs?.id === entityId) {
      show(loaded);
      return;
    }
    let cancelled = false;
    kbApi
      .listDocuments({ type: docType, entity_id: entityId, limit: 1 })
      .then(({ documents }) => !cancelled && show(documents[0]))
      .catch((err: Error) => {
        if (cancelled) return;
        // The API may answer "not found" instead of an empty list.
        if (err instanceof KbApiError && err.status === 404) show(undefined);
        else setError(`Couldn't load this entity: ${err.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [docType, entityId, subSectionsRefresh]);

  const sub = subSections.find((s) => subKey(s) === selectedSub);

  const load = () => {
    if (!entityId) return;
    onLoad({
      docType,
      entityId,
      ...(sub && { subSection: { type: sub.type, id: sub.id } }),
      ...(sub && workflow && { workflow }),
    });
  };

  // The entity's name becomes the title (editable until the first save).
  const start = () => {
    if (entityId) onCreate(docType, entityId, labelOf(ENTITIES, entityId));
  };

  return (
    <div className="scope-bar">
      <label>
        Document
        <select
          value={docType}
          onChange={(e) => {
            setDocType(e.target.value as DocType);
            setSelectedSub("");
            setWorkflow("");
          }}
        >
          {DOC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Entity
        <select
          value={entityId}
          onChange={(e) => {
            setEntityId(e.target.value as EntityId);
            setSelectedSub("");
            setWorkflow("");
          }}
        >
          <option value="" disabled>
            Choose an entity…
          </option>
          {ENTITIES.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </label>

      {hasDocument === false ? (
        <>
          <span className="scope-bar__hint">No {labelOf(DOC_TYPES, docType)} document yet.</span>
          <button type="button" className="scope-bar__load" onClick={start} disabled={loading}>
            Start document
          </button>
        </>
      ) : (
        <>
          <label>
            Subsection
            <select
              value={selectedSub}
              onChange={(e) => {
                setSelectedSub(e.target.value);
                setWorkflow("");
              }}
            >
              <option value="">All (whole entity)</option>
              {SUBSECTION_TYPES.map((t) => {
                const ofType = subSections.filter((s) => s.type === t.value);
                if (ofType.length === 0) return null;
                return (
                  <optgroup key={t.value} label={t.label}>
                    {ofType.map((s) => (
                      <option key={subKey(s)} value={subKey(s)}>
                        {s.id} · {s.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>

          <label>
            Workflow
            <select
              value={workflow}
              disabled={!sub || sub.workflows.length === 0}
              onChange={(e) => setWorkflow(e.target.value as WorkflowId | "")}
            >
              <option value="">All workflows</option>
              {sub?.workflows.map((w) => (
                <option key={w} value={w}>
                  {labelOf(WORKFLOWS, w)}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="scope-bar__load" onClick={load} disabled={loading || !entityId}>
            {loading ? "Loading…" : "Load"}
          </button>
        </>
      )}

      {error && <span className="scope-bar__error">{error}</span>}
    </div>
  );
};
