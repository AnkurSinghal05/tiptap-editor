import { useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { kbApi } from "../api/kb";
import { DOC_TYPES, type DocType, type KbDocument } from "../api/kb/types";
import type { Scope } from "../editor/scope";
import { SUBSECTION_TYPES, WORKFLOWS, labelOf, type SubSectionType, type WorkflowId } from "../editor/taxonomy";

interface ScopeBarProps {
  loading: boolean;
  // Bump to re-fetch the lists (e.g. after a save created a subsection).
  refreshToken: number;
  onLoad: (scope: Scope) => void;
  onCreate: (docType: DocType, entityId: string, title: string) => void;
}

interface EntityOption {
  id: string;
  title: string;
}

interface SubSectionOption {
  type: SubSectionType;
  id: string;
  name: string;
  workflows: WorkflowId[];
}

const NEW_ENTITY = "__new__";
const PAGE_SIZE = 100;

const textOf = (n: JSONContent | undefined): string =>
  !n ? "" : n.text ?? (n.content ?? []).map(textOf).join("");
const sectionOf = (d: KbDocument) => d.doc.content?.[0];
const subKey = (s: { type: string; id: string }) => `${s.type}:${s.id}`;

// Filters for what to load: document type and entity (required) →
// subsection (optional) → workflow (optional, only once a subsection is chosen).
export const ScopeBar = ({ loading, refreshToken, onLoad, onCreate }: ScopeBarProps) => {
  const [docType, setDocType] = useState<DocType>(DOC_TYPES[0].value);
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [entityId, setEntityId] = useState("");
  const [subSections, setSubSections] = useState<SubSectionOption[]>([]);
  const [selectedSub, setSelectedSub] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowId | "">("");
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Entities that have a document of this type (every page).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      const found: EntityOption[] = [];
      try {
        for (let offset = 0; ; offset += PAGE_SIZE) {
          const { documents, pagination } = await kbApi.listDocuments({ type: docType, limit: PAGE_SIZE, offset });
          for (const d of documents) {
            const section = sectionOf(d);
            if (section?.attrs?.id) found.push({ id: section.attrs.id, title: textOf(section.content?.[0]) });
          }
          if (offset + PAGE_SIZE >= pagination.total) break;
        }
      } catch (err) {
        if (!cancelled) setError(`Couldn't load entities: ${(err as Error).message}`);
      }
      if (cancelled) return;
      setEntities(found);
      setEntityId((current) =>
        current === NEW_ENTITY || found.some((e) => e.id === current) ? current : found[0]?.id ?? NEW_ENTITY,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [docType, refreshToken]);

  // Subsections (and their workflows) of the chosen entity.
  useEffect(() => {
    setSubSections([]);
    if (!entityId || entityId === NEW_ENTITY) return;
    let cancelled = false;
    kbApi
      .listDocuments({ type: docType, entity_id: entityId, limit: 1 })
      .then(({ documents }) => {
        if (cancelled) return;
        const section = documents[0] && sectionOf(documents[0]);
        const subs = (section?.content ?? [])
          .filter((n) => n.type === "subSection")
          .map((n) => ({
            type: n.attrs!.type as SubSectionType,
            id: n.attrs!.id as string,
            name: (n.attrs!.name as string) || textOf(n.content?.[0]),
            workflows: (n.content ?? []).filter((w) => w.type === "workflow").map((w) => w.attrs!.id as WorkflowId),
          }));
        setSubSections(subs);
        setSelectedSub((current) => (subs.some((s) => subKey(s) === current) ? current : ""));
      })
      .catch((err: Error) => !cancelled && setError(`Couldn't load subsections: ${err.message}`));
    return () => {
      cancelled = true;
    };
  }, [docType, entityId, refreshToken]);

  const sub = subSections.find((s) => subKey(s) === selectedSub);
  const creating = entityId === NEW_ENTITY;

  const load = () => {
    if (!entityId || creating) return;
    onLoad({
      docType,
      entityId,
      ...(sub && { subSection: { type: sub.type, id: sub.id } }),
      ...(sub && workflow && { workflow }),
    });
  };

  const create = () => {
    const id = newId.trim();
    const title = newTitle.trim();
    if (!id || !title) return setError("Entity id and title are required.");
    if (id.length > 100) return setError("Entity id can be at most 100 characters.");
    if (entities.some((e) => e.id === id)) return setError(`"${id}" already has a ${labelOf(DOC_TYPES, docType)} document. Select it instead.`);
    setError(null);
    onCreate(docType, id, title);
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
            setEntityId(e.target.value);
            setSelectedSub("");
            setWorkflow("");
          }}
        >
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title ? `${e.title} (${e.id})` : e.id}
            </option>
          ))}
          <option value={NEW_ENTITY}>+ New entity…</option>
        </select>
      </label>

      {creating ? (
        <>
          <label>
            Entity id
            <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="e.g. spa-access" />
          </label>
          <label>
            Title
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Spa Access" />
          </label>
          <button type="button" className="scope-bar__load" onClick={create} disabled={loading}>
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
