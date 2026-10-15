import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Image } from "@tiptap/extension-image";
import { TextAlign } from "@tiptap/extension-text-align";
import { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

import { CustomDocument } from "./extensions/CustomDocument";
import { Section } from "./extensions/Section";
import { SubSection } from "./extensions/SubSection";
import { Workflow } from "./extensions/Workflow";
import { Clause } from "./extensions/Clause";
import { CustomHeading } from "./extensions/CustomHeading";
import { StructureGuard, findSaveProblems, findStructureProblems } from "./extensions/StructureGuard";
import { ScopeLock } from "./extensions/ScopeLock";
import { TitleLock } from "./extensions/TitleLock";
import { ClauseMoveGuard } from "./extensions/ClauseMoveGuard";
import { CLAUSE_ERRORS_REFRESH_META, ClauseErrors } from "./extensions/ClauseErrors";
import { REMOTE_SYNC_META, describeScope, isPosInScope, type Scope } from "./scope";
import { WORKFLOWS, labelOf, type TaxonomyOption } from "./taxonomy";
import { generateTempClauseId } from "./utils/ids";
import {
  captureBaseline,
  changeCount,
  clauseInsertPos,
  clauseJSON,
  computeChanges,
  containersWithSavedClauses,
  findEmptyNewContainers,
  planAddRequests,
  planDeleteRequests,
  type Baseline,
} from "./sync/changes";
import { createDocument, saveChanges } from "./sync/saveChanges";
import { Toolbar } from "./Toolbar";
import { TagsDialog } from "../components/TagsDialog";
import { OptionPickerDialog } from "../components/OptionPickerDialog";
import { SubSectionDialog, type NewSubSection } from "../components/SubSectionDialog";
import { ScopeBar } from "../components/ScopeBar";
import { apiLog, kbApi, usingMockApi } from "../api/kb";
import { ApiLogPanel } from "../components/ApiLogPanel";
import { MAX_CLAUSES_PER_DELETE, MAX_CLAUSES_PER_REQUEST, PROJECT_CODE } from "../api/kb/config";
import type { DocType } from "../api/kb/types";

type Tab = "render" | "json" | "log";

type Status =
  | { kind: "idle" | "loading" | "saving" | "saved" }
  | { kind: "notice"; message: string }
  | { kind: "error"; message: string; problems?: string[]; needsReload?: boolean };

interface PickerState {
  title: string;
  hint: string;
  options: TaxonomyOption[];
  onConfirm: (value: string) => void;
}

const EMPTY_BASELINE: Baseline = { clauses: new Map(), containers: new Set() };

const PLACEHOLDER_DOC = {
  type: "doc",
  content: [
    {
      type: "section",
      attrs: { id: "" },
      content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Nothing loaded" }] }],
    },
  ],
};

export const Editor = () => {
  const [showTagsDialog, setShowTagsDialog] = useState(false);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [subSectionDialogKeys, setSubSectionDialogKeys] = useState<Set<string> | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("render");
  const [html, setHtml] = useState("");
  const [payload, setPayload] = useState("");
  const pendingInsertPosRef = useRef<number | null>(null);

  // ---- Backend sync state -------------------------------------------------
  const [scope, setScope] = useState<Scope | null>(null);
  const scopeRef = useRef<Scope | null>(null);
  const [entityTitle, setEntityTitle] = useState("");
  // True while editing a document that doesn't exist on the backend yet.
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  // What the backend has, as of the last load or save.
  const baselineRef = useRef<Baseline>(EMPTY_BASELINE);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pendingChanges, setPendingChanges] = useState(0);
  const savingRef = useRef(false);
  // Set when an append got no response: saving again could duplicate clauses.
  const needsReloadRef = useRef(false);
  // temp id → backend id for clauses saved this session (redo/paste of a
  // just-saved clause picks its real id up again).
  const sessionIdMapRef = useRef(new Map<string, string>());
  const clauseErrorsRef = useRef(new Map<string, string[]>());
  const [listToken, setListToken] = useState(0);

  // Ref-based callback keeps the extension's option stable while letting
  // React state setters be invoked through the closure below.
  const requestClauseAtRef = useRef<(pos: number) => void>(() => {});

  // Pending changes + the requests Save would send (shown in the side panel).
  const refreshDerived = (doc: PMNode, html: string) => {
    setHtml(html);
    const current = scopeRef.current;
    if (!current) {
      setPendingChanges(0);
      setPayload("");
      return;
    }
    if (creatingRef.current) {
      setPendingChanges(1);
      setPayload(JSON.stringify({ "POST /knowledge-base": { type: current.docType, doc: doc.toJSON() } }, null, 2));
      return;
    }
    const changes = computeChanges(doc, baselineRef.current);
    setPendingChanges(changeCount(changes));
    const adds = planAddRequests(current.docType, current.entityId, changes.added, MAX_CLAUSES_PER_REQUEST);
    setPayload(
      JSON.stringify(
        {
          "Project-Code": PROJECT_CODE,
          "POST /knowledge-base/clauses": adds.filter((a) => a.kind === "single").map((a) => a.body),
          "POST /knowledge-base/append": adds.filter((a) => a.kind === "append").map((a) => a.body),
          "PATCH /knowledge-base/clauses/{id}": changes.updated.map((u) => ({
            id: u.id,
            body: { type: current.docType, entity_id: current.entityId, clause: clauseJSON(u.node) },
          })),
          "POST /knowledge-base/clauses/delete": planDeleteRequests(
            current.docType,
            current.entityId,
            changes.deleted,
            MAX_CLAUSES_PER_DELETE,
          ),
        },
        null,
        2,
      ),
    );
  };

  const editor = useEditor({
    editable: false,
    extensions: [
      CustomDocument,
      Section,
      SubSection,
      Workflow,
      Clause.configure({
        resolveTempId: (tempId) => sessionIdMapRef.current.get(tempId),
        isKnownId: (id) => baselineRef.current.clauses.has(id),
      }),
      StarterKit.configure({ document: false, heading: false }),
      CustomHeading.configure({
        onRequestClauseAt: (pos: number) => {
          requestClauseAtRef.current(pos);
          return true;
        },
      }),
      StructureGuard.configure({
        onReject: (problems) => window.alert(`That change was blocked:\n\n${problems.join("\n")}`),
      }),
      ScopeLock.configure({ getScope: () => scopeRef.current }),
      TitleLock.configure({ getLockedKeys: () => baselineRef.current.containers }),
      ClauseMoveGuard.configure({
        getBaseline: () => baselineRef.current,
        onReject: (message) => window.alert(message),
      }),
      ClauseErrors.configure({ getErrors: () => clauseErrorsRef.current }),
      Underline,
      Image,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: PLACEHOLDER_DOC,
    onUpdate: ({ editor }) => refreshDerived(editor.state.doc, editor.getHTML()),
  });

  const dirty = pendingChanges > 0;

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Replaces the editor's state (not setContent), so undo history can't reach
  // back into the previous document and the edit guards don't judge the swap.
  const showDocument = (doc: PMNode, next: Scope, opts: { creating: boolean }) => {
    if (!editor) return;
    scopeRef.current = next;
    creatingRef.current = opts.creating;
    baselineRef.current = opts.creating ? EMPTY_BASELINE : captureBaseline(doc);
    clauseErrorsRef.current = new Map();
    needsReloadRef.current = false;
    editor.view.updateState(EditorState.create({ doc, plugins: editor.state.plugins }));
    setScope(next);
    setCreating(opts.creating);
    setEntityTitle(doc.firstChild?.firstChild?.textContent ?? "");
    refreshDerived(editor.state.doc, editor.getHTML());
  };

  const confirmDiscard = () => !dirty || window.confirm("You have unsaved changes. Discard them?");

  const loadScope = async (next: Scope, { force = false, savedStatus = false } = {}) => {
    if (!editor) return;
    if (!force && !confirmDiscard()) return;

    setStatus({ kind: "loading" });
    editor.setEditable(false, false);
    try {
      const { documents } = await kbApi.listDocuments({
        type: next.docType,
        entity_id: next.entityId,
        sub_section_type: next.subSection?.type,
        sub_section_id: next.subSection?.id,
        workflow_id: next.subSection ? next.workflow : undefined,
        limit: 1,
      });
      if (documents.length === 0) {
        if (savedStatus) {
          // The save removed the last clause in this selection.
          scopeRef.current = null;
          baselineRef.current = EMPTY_BASELINE;
          editor.view.updateState(
            EditorState.create({ doc: editor.schema.nodeFromJSON(PLACEHOLDER_DOC), plugins: editor.state.plugins }),
          );
          setScope(null);
          refreshDerived(editor.state.doc, editor.getHTML());
          setStatus({ kind: "notice", message: "Saved. No clauses are left in this selection." });
        } else {
          setStatus({ kind: "error", message: "Nothing found for this selection." });
        }
        return;
      }
      const doc = editor.schema.nodeFromJSON(documents[0].doc);
      doc.check();
      showDocument(doc, next, { creating: false });

      const problems = findStructureProblems(doc);
      setStatus(
        problems.length > 0
          ? { kind: "error", message: "This document breaks the editor's structure rules:", problems }
          : { kind: savedStatus ? "saved" : "idle" },
      );
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      editor.setEditable(scopeRef.current !== null, false);
    }
  };

  const startCreate = (docType: DocType, entityId: string, title: string) => {
    if (!editor || !confirmDiscard()) return;
    const doc = editor.schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "section",
          attrs: { id: entityId },
          content: [
            { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
            { type: "clause", attrs: { id: generateTempClauseId(), tags: [] }, content: [{ type: "paragraph" }] },
          ],
        },
      ],
    });
    showDocument(doc, { docType, entityId }, { creating: true });
    setStatus({ kind: "idle" });
    editor.setEditable(true, false);
    editor.commands.focus("end");
  };

  // On first load, open the first entity that has a T&C document.
  const initialLoadRef = useRef(false);
  useEffect(() => {
    if (!editor || initialLoadRef.current) return;
    initialLoadRef.current = true;
    void (async () => {
      try {
        const { documents } = await kbApi.listDocuments({ type: "tnc", limit: 1 });
        const entityId = documents[0]?.doc.content?.[0]?.attrs?.id;
        if (entityId) await loadScope({ docType: "tnc", entityId }, { force: true });
        else setStatus({ kind: "error", message: "No documents yet. Choose “+ New entity…” to create one." });
      } catch (err) {
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;

  const setClauseErrors = (errors: Map<string, string[]>) => {
    clauseErrorsRef.current = errors;
    editor.view.dispatch(editor.state.tr.setMeta(CLAUSE_ERRORS_REFRESH_META, true));
  };

  // Swaps editor clause ids for backend ids by id (not position). Not added
  // to undo history.
  const applyIdSwaps = (swaps: Map<string, string>) => {
    const tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "clause") return true;
      const next = swaps.get(node.attrs.id);
      if (next) tr.setNodeAttribute(pos, "id", next);
      return false;
    });
    if (!tr.docChanged) return;
    tr.setMeta(REMOTE_SYNC_META, true).setMeta("addToHistory", false);
    editor.view.dispatch(tr);
  };

  const errorList = (o: { clauseErrors: Map<string, string[]>; general: string[] }) => [
    ...o.general,
    ...(o.clauseErrors.size > 0
      ? [`${o.clauseErrors.size} clause${o.clauseErrors.size > 1 ? "s are" : " is"} highlighted in red; hover for details.`]
      : []),
  ];

  const handleSave = async () => {
    const current = scopeRef.current;
    if (!current || savingRef.current || needsReloadRef.current) return;

    const doc = editor.state.doc;
    const problems = [...findSaveProblems(doc), ...findEmptyNewContainers(doc, baselineRef.current)];
    if (problems.length > 0) {
      setStatus({ kind: "error", message: "Fix these before saving:", problems });
      return;
    }
    // Base deletes are final for every program, so confirm them.
    const deletions = creatingRef.current ? 0 : computeChanges(doc, baselineRef.current).deleted.length;
    if (
      deletions > 0 &&
      !window.confirm(
        `This save deletes ${deletions} clause${deletions > 1 ? "s" : ""} for every program, including programs that edited ${deletions > 1 ? "them" : "it"}. Continue?`,
      )
    ) {
      return;
    }

    savingRef.current = true;
    setStatus({ kind: "saving" });
    editor.setEditable(false, false);
    try {
      if (creatingRef.current) {
        const result = await createDocument(kbApi, current.docType, doc);
        setClauseErrors(result.clauseErrors);
        if (result.ok) {
          setListToken((t) => t + 1);
          await loadScope(current, { force: true, savedStatus: true });
        } else {
          setStatus({ kind: "error", message: "The document wasn't created:", problems: errorList(result) });
        }
        return;
      }

      const outcome = await saveChanges(kbApi, current.docType, current.entityId, doc, baselineRef.current);
      for (const [from, to] of outcome.idSwaps) sessionIdMapRef.current.set(from, to);
      baselineRef.current = outcome.baseline;
      applyIdSwaps(outcome.idSwaps);
      setListToken((t) => t + 1);

      if (outcome.failed === 0) {
        // Re-render from the backend: it decides the final order (new clauses last).
        await loadScope(current, { force: true, savedStatus: true });
        return;
      }

      // Partial save: keep the editor as it is, with what failed still pending.
      outcome.baseline.containers = new Set([
        ...outcome.baseline.containers,
        ...containersWithSavedClauses(editor.state.doc, outcome.baseline),
      ]);
      needsReloadRef.current = outcome.uncertain;
      setClauseErrors(outcome.clauseErrors);
      refreshDerived(editor.state.doc, editor.getHTML());
      setStatus({
        kind: "error",
        message: `${outcome.failed} change${outcome.failed > 1 ? "s" : ""} couldn't be saved. The rest were saved.`,
        problems: errorList(outcome),
        needsReload: outcome.uncertain,
      });
    } finally {
      savingRef.current = false;
      editor.setEditable(scopeRef.current !== null && !needsReloadRef.current, false);
    }
  };

  // ---- Structure editing ----------------------------------------------------

  const findAncestorDepth = (typeName: string): number | null => {
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === typeName) return d;
    }
    return null;
  };

  const inScope = (pos: number) => !scope || isPosInScope(editor.state.doc, scope, pos);

  // End of the clause list of the innermost container around `pos`.
  const clausePosInContainerAt = (pos: number): number | null => {
    const $pos = editor.state.doc.resolve(pos);
    for (let d = $pos.depth; d > 0; d--) {
      const node = $pos.node(d);
      if (["section", "subSection", "workflow"].includes(node.type.name)) {
        return clauseInsertPos(node, $pos.before(d));
      }
    }
    return null;
  };

  const openTagsDialogAt = (pos: number | null) => {
    if (pos === null || !inScope(pos)) {
      window.alert("Place the cursor inside the loaded scope to add a clause.");
      return;
    }
    pendingInsertPosRef.current = pos;
    setShowTagsDialog(true);
  };

  requestClauseAtRef.current = (pos: number) => openTagsDialogAt(clausePosInContainerAt(pos));

  // New containers start with one empty clause (the backend doesn't store
  // empty containers); the cursor goes into it.
  const insertContainer = (
    pos: number,
    type: string,
    attrs: Record<string, unknown>,
    level: 2 | 3,
    title: string,
  ) => {
    const titleNode = { type: "heading", attrs: { level }, content: [{ type: "text", text: title }] };
    const clause = { type: "clause", attrs: { id: generateTempClauseId(), tags: [] }, content: [{ type: "paragraph" }] };
    // container open (1) + title (text + 2) + clause open (1) + paragraph open (1)
    const cursor = pos + 1 + title.length + 2 + 2;
    editor
      .chain()
      .insertContentAt(pos, { type, attrs, content: [titleNode, clause] })
      .setTextSelection(cursor)
      .focus()
      .run();
  };

  const handlePickerConfirm = (value: string) => {
    const current = picker;
    setPicker(null);
    current?.onConfirm(value);
  };

  // New subsections go at the end of the section (where the backend adds them).
  const handleAddSubSection = () => {
    const sectionDepth = findAncestorDepth("section");
    if (sectionDepth === null) {
      window.alert("Place the cursor inside the document to add a subsection.");
      return;
    }
    const { $from } = editor.state.selection;
    const keys = new Set<string>();
    $from.node(sectionDepth).forEach((child) => {
      if (child.type.name === "subSection") keys.add(`${child.attrs.type}:${child.attrs.id}`);
    });
    pendingInsertPosRef.current = $from.end(sectionDepth);
    setSubSectionDialogKeys(keys);
  };

  const handleSubSectionConfirm = ({ type, id, name }: NewSubSection) => {
    setSubSectionDialogKeys(null);
    const pos = pendingInsertPosRef.current;
    pendingInsertPosRef.current = null;
    if (pos === null) return;
    insertContainer(pos, "subSection", { type, id, name }, 2, name);
  };

  // New workflows go at the end of the subsection (where the backend adds them).
  const handleAddWorkflow = () => {
    const subDepth = findAncestorDepth("subSection");
    if (subDepth === null) {
      window.alert("Place the cursor inside a subsection to add a workflow.");
      return;
    }
    const { $from } = editor.state.selection;
    const used = new Set<string>();
    $from.node(subDepth).forEach((child) => {
      if (child.type.name === "workflow") used.add(child.attrs.id);
    });
    const options = WORKFLOWS.filter((w) => !used.has(w.value));
    if (options.length === 0) {
      window.alert("This subsection already has every workflow.");
      return;
    }
    const pos = $from.end(subDepth);
    setPicker({
      title: "Add workflow",
      hint: "Each workflow can appear once per subsection. Its title can be edited until it's saved.",
      options: [...options],
      onConfirm: (id) => insertContainer(pos, "workflow", { id }, 3, labelOf(WORKFLOWS, id)),
    });
  };

  // New clauses go at the end of the current container's clauses.
  const handleAddClause = () => openTagsDialogAt(clausePosInContainerAt(editor.state.selection.from));

  const handleTagsConfirm = (tags: string[]) => {
    setShowTagsDialog(false);
    const pos = pendingInsertPosRef.current;
    pendingInsertPosRef.current = null;
    if (pos === null || !inScope(pos)) return;

    editor
      .chain()
      .insertContentAt(pos, {
        type: "clause",
        attrs: { id: generateTempClauseId(), tags },
        content: [{ type: "paragraph" }],
      })
      .setTextSelection(pos + 2)
      .focus()
      .run();
  };

  const handleTagsCancel = () => {
    pendingInsertPosRef.current = null;
    setShowTagsDialog(false);
  };

  const busy = status.kind === "loading" || status.kind === "saving";

  const statusText = (() => {
    switch (status.kind) {
      case "loading":
        return "Loading…";
      case "saving":
        return "Saving…";
      case "error":
      case "notice":
        return null;
      default:
        if (creating) return "New document, not saved yet";
        if (dirty) return `${pendingChanges} unsaved change${pendingChanges > 1 ? "s" : ""}`;
        return status.kind === "saved" ? "All changes saved" : "No changes";
    }
  })();

  return (
    <>
      <ScopeBar loading={busy} refreshToken={listToken} onLoad={(next) => void loadScope(next)} onCreate={startCreate} />

      <div className="workspace">
        <div className="panel">
          <div className="panel-header scope-header">
            <span className="scope-breadcrumb">
              {scope ? describeScope(scope, entityTitle).join(" › ") : "Nothing loaded"}
              <span className="scope-mock">
                {" "}
                · {PROJECT_CODE}
                {usingMockApi && " · mock backend"}
              </span>
            </span>
            {statusText && (
              <span className={dirty ? "scope-status scope-status--dirty" : "scope-status"}>{statusText}</span>
            )}
            <button
              type="button"
              className="scope-save"
              onClick={() => void handleSave()}
              disabled={!scope || busy || !dirty || needsReloadRef.current}
            >
              {creating ? "Create document" : "Save"}
            </button>
          </div>

          {status.kind === "notice" && (
            <div className="scope-notice" role="status">
              {status.message}
            </div>
          )}

          {status.kind === "error" && (
            <div className="scope-alert" role="alert">
              <div>{status.message}</div>
              {status.problems && status.problems.length > 0 && (
                <ul>
                  {status.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              {status.needsReload && scope && (
                <button type="button" onClick={() => void loadScope(scope, { force: true })}>
                  Reload
                </button>
              )}
            </div>
          )}

          <Toolbar
            editor={editor}
            onAddSubSection={handleAddSubSection}
            onAddWorkflow={handleAddWorkflow}
            onAddClause={handleAddClause}
            canAddSubSection={!!scope && !scope.subSection}
            canAddWorkflow={!!scope && !scope.workflow}
          />
          <div className="panel-body editor-surface">
            <EditorContent editor={editor} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-header panel-header--tabs">
            <button
              type="button"
              className={activeTab === "render" ? "tab tab--active" : "tab"}
              onClick={() => setActiveTab("render")}
            >
              Render
            </button>
            <button
              type="button"
              className={activeTab === "json" ? "tab tab--active" : "tab"}
              onClick={() => setActiveTab("json")}
            >
              Pending requests
            </button>
            {apiLog && (
              <button
                type="button"
                className={activeTab === "log" ? "tab tab--active" : "tab"}
                onClick={() => setActiveTab("log")}
              >
                API log
              </button>
            )}
          </div>

          {activeTab === "render" && (
            <div className="panel-body render-surface" dangerouslySetInnerHTML={{ __html: html }} />
          )}
          {activeTab === "json" && (
            <textarea className="panel-body json-surface" value={payload} readOnly spellCheck={false} />
          )}
          {activeTab === "log" && apiLog && <ApiLogPanel log={apiLog} />}
        </div>
      </div>

      <TagsDialog
        open={showTagsDialog}
        title="Tags for new clause"
        onConfirm={handleTagsConfirm}
        onCancel={handleTagsCancel}
      />

      <OptionPickerDialog
        open={picker !== null}
        title={picker?.title ?? ""}
        hint={picker?.hint}
        options={picker?.options ?? []}
        onConfirm={handlePickerConfirm}
        onCancel={() => setPicker(null)}
      />

      <SubSectionDialog
        open={subSectionDialogKeys !== null}
        existingKeys={subSectionDialogKeys ?? new Set()}
        onConfirm={handleSubSectionConfirm}
        onCancel={() => {
          pendingInsertPosRef.current = null;
          setSubSectionDialogKeys(null);
        }}
      />
    </>
  );
};
