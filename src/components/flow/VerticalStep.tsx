import { useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { MdArrowBack, MdArrowForward, MdCheckCircle, MdOutlineFileUpload, MdSearch } from "react-icons/md";
import { kbApi } from "../../api/kb";
import { KbApiError } from "../../api/kb/client";
import { IS_BASE_PROJECT, PROJECT_LABEL } from "../../api/kb/config";
import { missingTokenHint } from "../../api/kb/errors";
import { DOC_TYPES, type DocType, type KbDocument, type KbEntity } from "../../api/kb/types";
import type { OpenRequest } from "../../editor/Editor";
import { ACCEPTED_FILES, type FileImport } from "../../editor/importFile";
import type { ImportResult, ImportTarget } from "../../editor/importJson";
import { labelOf } from "../../editor/taxonomy";
import { shortTypeLabel } from "./TypeStep";

// The verticals (GET /knowledge-base/entities).
export type EntitiesState =
  | { state: "loading" }
  | { state: "ready"; list: KbEntity[] }
  | { state: "error"; message: string; hint: string | null };

// What the backend has for the chosen vertical.
type Check =
  | { state: "idle" | "loading" }
  | { state: "ready"; document: KbDocument | null }
  | { state: "error"; message: string; hint: string | null };

type Start = "blank" | "file" | "json";

type FileState =
  | { state: "none" }
  | { state: "reading"; name: string }
  | { state: "ready"; result: FileImport }
  | { state: "error"; name: string; message: string };

interface VerticalStepProps {
  docType: DocType;
  // null until the list is first requested.
  entities: EntitiesState | null;
  onRetryEntities: () => void;
  value: string | null;
  onChange: (entityId: string) => void;
  onBack: () => void;
  // Returns what's wrong with the pasted JSON, or null (opened, or cancelled
  // by the user).
  onOpen: (request: OpenRequest) => string[] | null;
  checkJson: (text: string, target: ImportTarget) => ImportResult;
  readFile: (file: File) => Promise<FileImport>;
}

const countClauses = (node: JSONContent): number =>
  node.type === "clause" ? 1 : (node.content ?? []).reduce((n, c) => n + countClauses(c), 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// Inline text joins as is, list items with a dot, other blocks with a space.
const textOf = (n: JSONContent): string =>
  n.text ??
  (n.content ?? [])
    .map(textOf)
    .join(n.type === "paragraph" ? "" : n.type === "bulletList" || n.type === "orderedList" ? " · " : " ");
const PREVIEW_CLAUSES = 5;

// Step 2: which vertical (entity), and how to start when it has no document.
export const VerticalStep = ({
  docType,
  entities,
  onRetryEntities,
  value,
  onChange,
  onBack,
  onOpen,
  checkJson,
  readFile,
}: VerticalStepProps) => {
  const [query, setQuery] = useState("");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [retry, setRetry] = useState(0);
  const [start, setStart] = useState<Start>("blank");
  const [json, setJson] = useState("");
  const [file, setFile] = useState<FileState>({ state: "none" });
  const [dragging, setDragging] = useState(false);
  const [openErrors, setOpenErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The latest file chosen, so a slower earlier read can't overwrite it.
  const readSeqRef = useRef(0);

  // One request for the chosen vertical: its whole document, which the editor
  // then shows without fetching it again.
  useEffect(() => {
    if (!value) {
      setCheck({ state: "idle" });
      return;
    }
    let cancelled = false;
    setCheck({ state: "loading" });
    kbApi
      .listDocuments({ type: docType, entity_id: value, limit: 1 })
      .then(({ documents }) => documents[0] ?? null)
      .catch((err: unknown) => {
        // The API may answer "not found" instead of an empty list.
        if (err instanceof KbApiError && err.status === 404) return null;
        throw err;
      })
      .then(
        (document) => !cancelled && setCheck({ state: "ready", document }),
        (err: unknown) =>
          !cancelled &&
          setCheck({ state: "error", message: err instanceof Error ? err.message : String(err), hint: missingTokenHint(err) }),
      );
    return () => {
      cancelled = true;
    };
  }, [docType, value, retry]);

  const all = useMemo(() => (entities?.state === "ready" ? entities.list : []), [entities]);
  const verticals = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? all.filter((e) => e.entity_name.toLowerCase().includes(q) || e.entity_id.includes(q)) : all;
  }, [all, query]);

  const typeName = labelOf(DOC_TYPES, docType);
  const short = shortTypeLabel(docType);
  const name = value ? (all.find((e) => e.entity_id === value)?.entity_name ?? value) : "";
  const document = check.state === "ready" ? check.document : undefined;
  const pasting = document === null && start === "json" && json.trim() !== "";
  const jsonCheck = useMemo(
    () => (pasting && value ? checkJson(json, { docType, entityId: value, title: name }) : null),
    [pasting, json, docType, value, name, checkJson],
  );
  // An existing document opens; a missing one can be started by THRIWE_APP only.
  const canStart =
    IS_BASE_PROJECT &&
    (start === "blank" || (start === "json" && jsonCheck?.ok === true) || (start === "file" && file.state === "ready"));
  const canOpen = document !== undefined && (document !== null || canStart);

  const chooseFile = (chosen: File | undefined) => {
    if (!chosen) return;
    const seq = ++readSeqRef.current;
    setOpenErrors([]);
    setFile({ state: "reading", name: chosen.name });
    readFile(chosen).then(
      (result) => seq === readSeqRef.current && setFile({ state: "ready", result }),
      (err: unknown) =>
        seq === readSeqRef.current &&
        setFile({ state: "error", name: chosen.name, message: err instanceof Error ? err.message : String(err) }),
    );
  };

  const open = () => {
    if (!value || document === undefined) return;
    const source =
      document === null && start === "json" && pasting
        ? json
        : document === null && start === "file" && file.state === "ready"
          ? JSON.stringify({ type: docType, doc: file.result.doc })
          : undefined;
    const errors = onOpen({ docType, entityId: value, title: name, document, json: source });
    setOpenErrors(errors ?? []);
  };

  const statusOf = (): { kind: string; text: string } => {
    switch (check.state) {
      case "ready":
        return check.document
          ? { kind: "has", text: `${short} · ${plural(countClauses(check.document.doc), "clause")}` }
          : { kind: "none", text: `No ${short} yet` };
      case "error":
        return { kind: "error", text: "Couldn't check" };
      default:
        return { kind: "loading", text: "Checking…" };
    }
  };

  const openLabel = document
    ? "Open editor"
    : document === null
      ? { blank: "Start blank document", file: "Start from file", json: "Start from JSON" }[start]
      : "Open editor";

  const fileResult = file.state === "ready" ? file.result : null;
  const previewClauses = (fileResult?.doc.content?.[0]?.content ?? []).slice(0, PREVIEW_CLAUSES);

  return (
    <section className="flow-card" aria-labelledby="vertical-step-title">
      <div className="flow-card__head">
        <div>
          <h2 id="vertical-step-title">Which vertical is this {short} for?</h2>
          <p className="flow-card__lead">
            Each vertical has one {typeName} document. Picking one that already has it opens it in the editor.
          </p>
        </div>
        <span className="flow-chip">
          Type: <strong>{short}</strong>
          <button type="button" onClick={onBack}>
            Change
          </button>
        </span>
      </div>

      <label className="flow-search">
        <MdSearch aria-hidden />
        <input
          type="search"
          placeholder="Search verticals"
          aria-label="Search verticals"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {(!entities || entities.state === "loading") && <p className="flow-note">Loading verticals…</p>}
      {entities?.state === "error" && (
        <div className="flow-callout flow-callout--error" role="alert">
          <div>Couldn't load the verticals: {entities.message}</div>
          {entities.hint && <div>{entities.hint}</div>}
          <button type="button" onClick={onRetryEntities}>
            Try again
          </button>
        </div>
      )}

      <div className="choice-grid choice-grid--verticals" role="radiogroup" aria-label="Vertical">
        {verticals.map((e) => {
          const selected = value === e.entity_id;
          const status = selected ? statusOf() : null;
          return (
            <button
              key={e.entity_id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={selected ? "choice choice--selected" : "choice"}
              onClick={() => {
                onChange(e.entity_id);
                setOpenErrors([]);
              }}
            >
              <span className="choice__head">
                <span className="choice__title">{e.entity_name}</span>
                {selected && <MdCheckCircle className="choice__check" aria-hidden />}
              </span>
              <span className="choice__id">{e.entity_id}</span>
              {status && <span className={`vertical-status vertical-status--${status.kind}`}>{status.text}</span>}
            </button>
          );
        })}
      </div>
      {entities?.state === "ready" && verticals.length === 0 && (
        <p className="flow-note">{query.trim() ? `No vertical matches “${query}”.` : "The API returned no verticals."}</p>
      )}

      {value && check.state === "error" && (
        <div className="flow-callout flow-callout--error" role="alert">
          <div>
            Couldn't check {name}: {check.message}
          </div>
          {check.hint && <div>{check.hint}</div>}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}

      {document && (
        <div className="flow-callout flow-callout--info">
          {name} already has a {typeName} document ({plural(countClauses(document.doc), "clause")}). It opens in the
          editor, where you can also edit it as JSON.{" "}
          {IS_BASE_PROJECT
            ? "Saved changes apply to every program straight away."
            : `Saved changes apply to ${PROJECT_LABEL} only: its own version, on top of the base.`}
        </div>
      )}

      {document === null && !IS_BASE_PROJECT && (
        <div className="flow-callout flow-callout--info">
          {PROJECT_LABEL} has no {typeName} document for {name}. Either Thriwe hasn't created the base document yet, or{" "}
          {name} isn't mapped to this project. Only Thriwe (THRIWE_APP) can create documents.
        </div>
      )}

      {document === null && IS_BASE_PROJECT && (
        <div className="flow-start">
          <p>
            {name} has no {typeName} document yet. How do you want to start?
          </p>
          <div className="flow-start__options" role="radiogroup" aria-label="How to start">
            {(
              [
                ["blank", "Blank document"],
                ["file", "From a file"],
                ["json", "From JSON"],
              ] as const
            ).map(([option, label]) => (
              <label key={option}>
                <input type="radio" name="start" checked={start === option} onChange={() => setStart(option)} />
                {label}
              </label>
            ))}
          </div>

          {start === "file" && (
            <>
              <div
                className={dragging ? "flow-drop flow-drop--over" : "flow-drop"}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  chooseFile(e.dataTransfer.files[0]);
                }}
              >
                <span className="flow-drop__icon">
                  <MdOutlineFileUpload aria-hidden />
                </span>
                <span className="flow-drop__text">
                  <strong>{file.state === "none" ? "Drag and drop a file here, or browse" : "Drop another file to replace it"}</strong>
                  <span>PDF, DOCX or TXT · up to 10 MB · one file</span>
                </span>
                <button type="button" className="flow-secondary" onClick={() => fileInputRef.current?.click()}>
                  Browse files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_FILES}
                  hidden
                  onChange={(e) => {
                    chooseFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
              <p className="flow-note">
                The file is read in your browser and isn't sent anywhere until you create the document. Each paragraph
                becomes a clause, a list joins the paragraph before it, and headings become tags on the clauses below
                them. Everything goes directly under {name}; subsections can be added in the editor.
              </p>

              {file.state === "reading" && <div className="flow-callout flow-callout--info">Reading {file.name}…</div>}
              {file.state === "error" && (
                <div className="flow-callout flow-callout--error" role="alert">
                  {file.name}: {file.message}
                </div>
              )}
              {fileResult && (
                <div className="flow-callout flow-callout--ok">
                  <div>
                    <strong>{fileResult.fileName}</strong>: {plural(fileResult.clauses, "clause")}. You can review and
                    change them in the editor before creating the document.
                  </div>
                  <ul>
                    {fileResult.tags.length > 0 && (
                      <li>
                        Headings became tags:{" "}
                        {fileResult.tags.map((t) => `${t.heading} → ${t.tag} (${t.clauses})`).join(", ")}.
                      </li>
                    )}
                    {fileResult.title && <li>Left out the title line “{fileResult.title}”: the title is {name}.</li>}
                    {fileResult.imagesSkipped > 0 && <li>Left out {plural(fileResult.imagesSkipped, "image")}.</li>}
                  </ul>
                  <ol className="flow-preview">
                    {previewClauses.map((c, i) => (
                      <li key={i}>
                        {(c.attrs?.tags as string[] | undefined)?.length ? (
                          <span className="flow-preview__tags">{(c.attrs!.tags as string[]).join(", ")}</span>
                        ) : null}
                        {textOf(c).slice(0, 160)}
                        {textOf(c).length > 160 ? "…" : ""}
                      </li>
                    ))}
                  </ol>
                  {fileResult.clauses > PREVIEW_CLAUSES && (
                    <div className="flow-preview__more">and {plural(fileResult.clauses - PREVIEW_CLAUSES, "more clause")}</div>
                  )}
                </div>
              )}
            </>
          )}

          {start === "json" && (
            <>
              <textarea
                className="flow-json"
                aria-label="Document JSON"
                spellCheck={false}
                value={json}
                placeholder={'{ "type": "tnc", "doc": { "type": "doc", "content": [ { "type": "section", … } ] } }'}
                onChange={(e) => {
                  setJson(e.target.value);
                  setOpenErrors([]);
                }}
              />
              <p className="flow-note">
                Paste a document as sent to <code>POST /knowledge-base</code> (<code>{"{ type, doc }"}</code>), an API
                response with <code>data</code>, a Tiptap doc or a single section. It's saved for {name}, and clause ids
                are assigned when it's created.
              </p>
              {jsonCheck && !jsonCheck.ok && (
                <div className="flow-callout flow-callout--error" role="alert">
                  <div>This JSON can't be used yet:</div>
                  <ul>
                    {jsonCheck.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {jsonCheck?.ok && (
                <div className="flow-callout flow-callout--ok">
                  <div>Ready: {plural(jsonCheck.clauses, "clause")}. You can review it in the editor before creating it.</div>
                  {jsonCheck.warnings.length > 0 && (
                    <ul>
                      {jsonCheck.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {openErrors.length > 0 && (
        <div className="flow-callout flow-callout--error" role="alert">
          <ul>
            {openErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flow-actions">
        <button type="button" className="flow-secondary" onClick={onBack}>
          <MdArrowBack aria-hidden /> Back
        </button>
        <button type="button" className="flow-primary" onClick={open} disabled={!canOpen}>
          {openLabel} <MdArrowForward aria-hidden />
        </button>
      </div>
    </section>
  );
};
