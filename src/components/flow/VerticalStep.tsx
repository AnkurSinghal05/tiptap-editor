import { useEffect, useMemo, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { MdArrowBack, MdArrowForward, MdCheckCircle, MdSearch } from "react-icons/md";
import { kbApi } from "../../api/kb";
import { KbApiError } from "../../api/kb/client";
import { missingTokenHint } from "../../api/kb/errors";
import { DOC_TYPES, type DocType, type KbDocument } from "../../api/kb/types";
import type { OpenRequest } from "../../editor/Editor";
import type { ImportResult, ImportTarget } from "../../editor/importJson";
import { ENTITIES, labelOf, type EntityId } from "../../editor/taxonomy";
import { shortTypeLabel } from "./TypeStep";

// What the backend has for the chosen vertical.
type Check =
  | { state: "idle" | "loading" }
  | { state: "ready"; document: KbDocument | null }
  | { state: "error"; message: string; hint: string | null };

interface VerticalStepProps {
  docType: DocType;
  value: EntityId | null;
  onChange: (entityId: EntityId) => void;
  onBack: () => void;
  // Returns what's wrong with the pasted JSON, or null (opened, or cancelled
  // by the user).
  onOpen: (request: OpenRequest) => string[] | null;
  checkJson: (text: string, target: ImportTarget) => ImportResult;
}

const countClauses = (node: JSONContent): number =>
  node.type === "clause" ? 1 : (node.content ?? []).reduce((n, c) => n + countClauses(c), 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Step 2: which vertical (entity), and how to start when it has no document.
export const VerticalStep = ({ docType, value, onChange, onBack, onOpen, checkJson }: VerticalStepProps) => {
  const [query, setQuery] = useState("");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [retry, setRetry] = useState(0);
  const [fromJson, setFromJson] = useState(false);
  const [json, setJson] = useState("");
  const [openErrors, setOpenErrors] = useState<string[]>([]);

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

  const verticals = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ENTITIES.filter((e) => e.label.toLowerCase().includes(q) || e.value.includes(q)) : ENTITIES;
  }, [query]);

  const typeName = labelOf(DOC_TYPES, docType);
  const short = shortTypeLabel(docType);
  const name = value ? labelOf(ENTITIES, value) : "";
  const document = check.state === "ready" ? check.document : undefined;
  const pasting = document === null && fromJson && json.trim() !== "";
  const jsonCheck = useMemo(
    () => (pasting && value ? checkJson(json, { docType, entityId: value, title: labelOf(ENTITIES, value) }) : null),
    [pasting, json, docType, value, checkJson],
  );
  const canOpen = document !== undefined && (!(document === null && fromJson) || jsonCheck?.ok === true);

  const open = () => {
    if (!value || document === undefined) return;
    const errors = onOpen({ docType, entityId: value, title: name, document, json: pasting ? json : undefined });
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

      <div className="choice-grid choice-grid--verticals" role="radiogroup" aria-label="Vertical">
        {verticals.map((e) => {
          const selected = value === e.value;
          const status = selected ? statusOf() : null;
          return (
            <button
              key={e.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={selected ? "choice choice--selected" : "choice"}
              onClick={() => {
                onChange(e.value);
                setOpenErrors([]);
              }}
            >
              <span className="choice__head">
                <span className="choice__title">{e.label}</span>
                {selected && <MdCheckCircle className="choice__check" aria-hidden />}
              </span>
              <span className="choice__id">{e.value}</span>
              {status && <span className={`vertical-status vertical-status--${status.kind}`}>{status.text}</span>}
            </button>
          );
        })}
      </div>
      {verticals.length === 0 && <p className="flow-note">No vertical matches “{query}”.</p>}
      <p className="flow-note">Vertical not listed? Verticals come from a fixed list in the editor for now, because the API can't list them.</p>

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
          editor, where you can also edit it as JSON. Saved changes apply to every program straight away.
        </div>
      )}

      {document === null && (
        <div className="flow-start">
          <p>
            {name} has no {typeName} document yet. How do you want to start?
          </p>
          <div className="flow-start__options" role="radiogroup" aria-label="How to start">
            <label>
              <input type="radio" name="start" checked={!fromJson} onChange={() => setFromJson(false)} />
              Blank document
            </label>
            <label>
              <input type="radio" name="start" checked={fromJson} onChange={() => setFromJson(true)} />
              From JSON
            </label>
          </div>
          {fromJson && (
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
          {document ? "Open editor" : document === null ? (fromJson ? "Start from JSON" : "Start blank document") : "Open editor"}{" "}
          <MdArrowForward aria-hidden />
        </button>
      </div>
    </section>
  );
};
