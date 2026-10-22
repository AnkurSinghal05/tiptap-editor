import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Image } from "@tiptap/extension-image";
import { TextAlign } from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
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
import { REMOTE_SYNC_META, describeScope, findScopeNode, isPosInScope, type Scope } from "./scope";
import { WORKFLOWS, labelOf, type TaxonomyOption } from "./taxonomy";
import { STRUCTURE_HINT, parseDocumentJson, type ImportResult, type ImportTarget } from "./importJson";
import { readDocumentFile, type FileImport } from "./importFile";
import { forEachContainer, titleOf } from "./sync/containerKeys";
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
import { ScopeBar, type SubSectionsRefresh } from "../components/ScopeBar";
import { apiLog, apiMode, kbApi } from "../api/kb";
import { ApiLogPanel } from "../components/ApiLogPanel";
import { DocumentJsonPanel } from "../components/DocumentJsonPanel";
import { KbApiError } from "../api/kb/client";
import { missingTokenHint } from "../api/kb/errors";
import {
  KB_API_TARGET_URL,
  MAX_CLAUSES_PER_DELETE,
  MAX_CLAUSES_PER_REQUEST,
  PROJECT_CODE,
  setApiMode,
  type ApiMode,
} from "../api/kb/config";
import type { DocType, KbDocument } from "../api/kb/types";

type Tab = "render" | "json" | "requests" | "log";

export interface OpenRequest extends ImportTarget {
  // What the backend has for this vertical: its whole document, or null when
  // there's none yet (then a new document starts).
  document: KbDocument | null;
  // Pasted JSON to start the new document from (only without a document).
  json?: string;
}

// How the create flow drives the editor.
export interface EditorHandle {
  // Shows the vertical's document, or starts a new one. Returns what's wrong
  // with the pasted JSON, or null once it's open. Doesn't ask about unsaved
  // changes: the caller does.
  open(request: OpenRequest): string[] | null;
  checkJson(text: string, target: ImportTarget): ImportResult;
  // Splits a PDF, DOCX or TXT file into clauses (rejects with a readable message).
  readFile(file: File): Promise<FileImport>;
  isDirty(): boolean;
}

interface EditorProps {
  // False while the create flow's earlier steps are shown (the editor stays
  // mounted, hidden).
  active: boolean;
  onChangeVertical: () => void;
}

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

// A load failure, with a hint when live mode is refused because no
// development token is set.
const loadErrorStatus = (err: unknown): Status => {
  const message = err instanceof Error ? err.message : String(err);
  const hint = missingTokenHint(err);
  return hint ? { kind: "error", message, problems: [hint] } : { kind: "error", message };
};

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

export const Editor = forwardRef<EditorHandle, EditorProps>(({ active, onChangeVertical }, ref) => {
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
  // Scope bar refreshes, only when a save could have changed what it shows.
  const [subSectionsRefresh, setSubSectionsRefresh] = useState<SubSectionsRefresh>({});
  // The document type and vertical the create flow opened (the scope bar
  // narrows within it).
  const [opened, setOpened] = useState<{ docType: DocType; entityId: string; title: string } | null>(null);
  // Set while JSON from the JSON tab is applied: the edit guards report into
  // it instead of showing an alert.
  const guardRejectsRef = useRef<string[] | null>(null);
  // Focus the editor once it's shown (it's hidden while the flow's earlier
  // steps are on screen).
  const focusPendingRef = useRef(false);

  // Ref-based callback keeps the extension's option stable while letting
  // React state setters be invoked through the closure below.
  const requestClauseAtRef = useRef<(pos: number) => void>(() => {});
  // A saved or new clause whose tags are being edited (its "Edit tags" button).
  const [editTags, setEditTags] = useState<{ clauseId: string; tags: string[] } | null>(null);
  const editTagsRef = useRef<(clauseId: string) => void>(() => {});

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
        onEditTags: (id) => editTagsRef.current(id),
      }),
      StarterKit.configure({ document: false, heading: false }),
      CustomHeading.configure({
        onRequestClauseAt: (pos: number) => {
          requestClauseAtRef.current(pos);
          return true;
        },
      }),
      StructureGuard.configure({
        onReject: (problems) =>
          guardRejectsRef.current
            ? guardRejectsRef.current.push(...problems)
            : window.alert(`That change was blocked:\n\n${problems.join("\n")}`),
      }),
      ScopeLock.configure({ getScope: () => scopeRef.current }),
      TitleLock.configure({ getLockedKeys: () => baselineRef.current.containers }),
      ClauseMoveGuard.configure({
        getBaseline: () => baselineRef.current,
        onReject: (message) => (guardRejectsRef.current ? guardRejectsRef.current.push(message) : window.alert(message)),
      }),
      ClauseErrors.configure({ getErrors: () => clauseErrorsRef.current }),
      Underline,
      Image,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      // Tables are blocks, so a clause can hold one (the API stores clause
      // content as sent). No column resizing: it adds widths to the JSON.
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: PLACEHOLDER_DOC,
    onUpdate: ({ editor }) => refreshDerived(editor.state.doc, editor.getHTML()),
  });

  const dirty = pendingChanges > 0;

  // Warn before leaving the page with unsaved changes (unless the user has
  // already agreed to discard them, e.g. when switching backends).
  const discardConfirmedRef = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!discardConfirmedRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // The API client is created once per page load, so switching backends
  // stores the choice and reloads.
  const switchApiMode = (next: ApiMode) => {
    if (next === apiMode) return;
    const target = next === "mock" ? "the mock backend" : "the live API";
    if (dirty && !window.confirm(`You have unsaved changes. Discard them and switch to ${target}?`)) return;
    discardConfirmedRef.current = true;
    setApiMode(next);
    window.location.reload();
  };

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
      }).catch((err: unknown) => {
        // The API may answer "not found" instead of an empty list.
        if (err instanceof KbApiError && err.status === 404) return { documents: [] };
        throw err;
      });
      if (documents.length === 0) {
        if (savedStatus) {
          // The save removed the last clause in this selection. Listings skip
          // documents with no clauses, so the entity may have none any more.
          // (A scoped save has already refreshed the scope bar.)
          if (!next.subSection) setSubSectionsRefresh({});
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
      showLoaded(documents[0], next, savedStatus);
    } catch (err) {
      setStatus(loadErrorStatus(err));
    } finally {
      editor.setEditable(scopeRef.current !== null, false);
    }
  };

  // Shows a document fetched from the backend (throws if it doesn't fit the
  // editor's schema).
  const showLoaded = (document: KbDocument, next: Scope, savedStatus: boolean) => {
    if (!editor) return;
    const doc = editor.schema.nodeFromJSON(document.doc);
    doc.check();
    showDocument(doc, next, { creating: false });
    // The whole entity holds every subsection, so the scope bar reuses it.
    if (!next.subSection) setSubSectionsRefresh({ known: { docType: next.docType, entityId: next.entityId, document } });

    const problems = findStructureProblems(doc);
    setStatus(
      problems.length > 0
        ? { kind: "error", message: "This document breaks the editor's structure rules:", problems }
        : { kind: savedStatus ? "saved" : "idle" },
    );
  };

  const focusWhenShown = () => {
    if (active) editor?.commands.focus("end");
    else focusPendingRef.current = true;
  };

  useEffect(() => {
    if (!active || !focusPendingRef.current || !editor) return;
    focusPendingRef.current = false;
    editor.commands.focus("end");
  }, [active, editor]);

  // A new document: from pasted JSON, or a title and one empty clause.
  const startCreate = (docType: DocType, entityId: string, title: string, from?: PMNode) => {
    if (!editor) return;
    const doc =
      from ??
      editor.schema.nodeFromJSON({
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
    setSubSectionsRefresh({ known: { docType, entityId, document: null } });
    setStatus({ kind: "idle" });
    editor.setEditable(true, false);
    focusWhenShown();
  };

  useImperativeHandle(ref, () => ({
    open: (request) => {
      if (!editor) return ["The editor isn't ready yet. Try again in a moment."];
      const target = { docType: request.docType, entityId: request.entityId };
      let from: PMNode | undefined;
      if (!request.document && request.json?.trim()) {
        const parsed = parseDocumentJson(request.json, request, editor.schema);
        if (!parsed.ok) return parsed.errors;
        from = parsed.doc;
      }
      if (request.document) {
        try {
          showLoaded(request.document, target, false);
        } catch (err) {
          return [`This document can't be shown: ${err instanceof Error ? err.message : String(err)}`];
        }
        editor.setEditable(true, false);
        focusWhenShown();
      } else {
        startCreate(request.docType, request.entityId, request.title, from);
      }
      setOpened({ ...target, title: request.title });
      setActiveTab("render");
      return null;
    },
    checkJson: (text, target) =>
      editor ? parseDocumentJson(text, target, editor.schema) : { ok: false, errors: ["The editor isn't ready yet."] },
    readFile: (file) =>
      editor ? readDocumentFile(file, editor.schema) : Promise.reject(new Error("The editor isn't ready yet.")),
    // A new, unsaved document counts as one pending change.
    isDirty: () => pendingChanges > 0,
  }));

  if (!editor) return null;

  // Applies the JSON tab's edits as an ordinary edit: only the range that
  // changed is replaced, so the edit guards judge it and undo reverts it.
  // Returns what stopped it, or null once applied.
  const applyDocumentJson = (text: string): string[] | null => {
    const current = scopeRef.current;
    if (!current || !editor.isEditable) return ["Nothing can be edited right now."];
    let next: PMNode;
    try {
      next = editor.schema.nodeFromJSON(JSON.parse(text));
      next.check();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return err instanceof SyntaxError
        ? [`Not valid JSON: ${message}`]
        : [`It doesn't fit the document structure: ${message}`, STRUCTURE_HINT];
    }

    const old = editor.state.doc;
    const start = old.content.findDiffStart(next.content);
    if (start === null) return ["Nothing to apply: the JSON matches the editor."];
    let { a: endA, b: endB } = old.content.findDiffEnd(next.content)!;
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) {
      endA += overlap;
      endB += overlap;
    }

    // Two guards reject without saying why, so check their rules first.
    const problems: string[] = [];
    const found = findScopeNode(old, current);
    if (found && (start <= found.root.pos || endA >= found.root.pos + found.root.node.nodeSize)) {
      problems.push(
        current.subSection
          ? "Only the loaded subsection or workflow can change. Everything around it is shown for context."
          : "The section itself (the vertical's id) can't change, only what's inside it.",
      );
    }
    const savedTitles = new Map<string, string>();
    forEachContainer(old, ({ node, key }) => baselineRef.current.containers.has(key) && savedTitles.set(key, titleOf(node)));
    forEachContainer(next, ({ node, key }) => {
      const before = savedTitles.get(key);
      if (before !== undefined && before !== titleOf(node)) {
        problems.push(`Saved titles can't be renamed: "${before}" stays "${before}", not "${titleOf(node)}".`);
      }
    });
    if (problems.length > 0) return problems;

    const rejected: string[] = [];
    guardRejectsRef.current = rejected;
    try {
      editor.view.dispatch(editor.state.tr.replace(start, endA, next.slice(start, endB)));
    } catch (err) {
      return [`Couldn't apply it: ${err instanceof Error ? err.message : String(err)}`];
    } finally {
      guardRejectsRef.current = null;
    }
    // New clauses get their ids rewritten right after, so compare with the
    // old document, not the JSON.
    if (editor.state.doc.eq(old)) {
      return rejected.length > 0 ? rejected : ["The editor's rules blocked this change."];
    }
    return null;
  };

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

      if (outcome.failed === 0) {
        // A scoped reload holds only part of the entity, so its subsections
        // are fetched; a whole-entity reload refreshes them itself.
        if (current.subSection) setSubSectionsRefresh({});
        // Re-render from the backend: it decides the final order (new clauses last).
        await loadScope(current, { force: true, savedStatus: true });
        return;
      }

      // Partial save: nothing is reloaded, so refresh the scope bar.
      setSubSectionsRefresh({});
      // Keep the editor as it is, with what failed still pending.
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

  // Clauses are found by id, not position, so the dialog stays tied to its clause.
  const findClause = (id: string) => {
    let found: { node: PMNode; pos: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.type.name === "clause" && node.attrs.id === id) found = { node, pos };
      return node.type.name !== "clause";
    });
    return found as { node: PMNode; pos: number } | null;
  };

  editTagsRef.current = (id: string) => {
    const found = findClause(id);
    if (!found || !inScope(found.pos)) return;
    setEditTags({ clauseId: id, tags: [...(found.node.attrs.tags ?? [])] });
  };

  // An ordinary edit: undoable, counted as a pending change, saved as a PATCH.
  const handleEditTagsConfirm = (tags: string[]) => {
    const target = editTags;
    setEditTags(null);
    const found = target && findClause(target.clauseId);
    if (!found || JSON.stringify(found.node.attrs.tags ?? []) === JSON.stringify(tags)) return;
    editor.view.dispatch(editor.state.tr.setNodeAttribute(found.pos, "tags", tags));
  };

  // Every tag in the document, offered in the tags dialog.
  const documentTags = (() => {
    const all = new Set<string>();
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "clause") return true;
      (node.attrs.tags ?? []).forEach((t: string) => all.add(t));
      return false;
    });
    return [...all].sort();
  })();

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
      <ScopeBar
        docType={opened?.docType ?? null}
        entityId={opened?.entityId ?? null}
        entityName={opened?.title ?? null}
        creating={creating}
        loading={busy}
        subSectionsRefresh={subSectionsRefresh}
        onLoad={(next) => void loadScope(next)}
        onCreate={(docType, entityId, title) => confirmDiscard() && startCreate(docType, entityId, title)}
        onChangeVertical={onChangeVertical}
      />

      <div className="workspace">
        <div className="panel">
          <div className="panel-header scope-header">
            <span className="scope-breadcrumb">
              {scope ? describeScope(scope, entityTitle).join(" › ") : "Nothing loaded"}
              <span className="scope-mock"> · {PROJECT_CODE}</span>
            </span>
            <span
              className="api-mode"
              role="group"
              aria-label="Backend"
              title={apiMode === "live" ? `Live API: ${KB_API_TARGET_URL}` : "In-memory mock with sample data"}
            >
              {(["mock", "live"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={apiMode === m ? "api-mode__option api-mode__option--active" : "api-mode__option"}
                  aria-pressed={apiMode === m}
                  disabled={busy}
                  onClick={() => switchApiMode(m)}
                >
                  {m === "mock" ? "Mock" : "Live"}
                </button>
              ))}
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
              JSON
            </button>
            <button
              type="button"
              className={activeTab === "requests" ? "tab tab--active" : "tab"}
              onClick={() => setActiveTab("requests")}
            >
              Pending requests
            </button>
            <button
              type="button"
              className={activeTab === "log" ? "tab tab--active" : "tab"}
              onClick={() => setActiveTab("log")}
            >
              API log
            </button>
          </div>

          {activeTab === "render" && (
            <div className="panel-body render-surface" dangerouslySetInnerHTML={{ __html: html }} />
          )}
          {activeTab === "json" && (
            <DocumentJsonPanel
              doc={editor.state.doc}
              editable={!!scope && !busy && !needsReloadRef.current}
              onApply={applyDocumentJson}
            />
          )}
          {activeTab === "requests" && (
            <textarea className="panel-body json-surface" value={payload} readOnly spellCheck={false} />
          )}
          {activeTab === "log" && <ApiLogPanel log={apiLog} />}
        </div>
      </div>

      <TagsDialog
        open={showTagsDialog}
        title="Tags for new clause"
        suggestions={documentTags}
        onConfirm={handleTagsConfirm}
        onCancel={handleTagsCancel}
      />

      {/* Keyed by clause, so it opens with that clause's tags from the first frame. */}
      <TagsDialog
        key={editTags?.clauseId ?? "closed"}
        open={editTags !== null}
        title="Edit clause tags"
        initialTags={editTags?.tags}
        suggestions={documentTags}
        onConfirm={handleEditTagsConfirm}
        onCancel={() => setEditTags(null)}
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
});

Editor.displayName = "Editor";
