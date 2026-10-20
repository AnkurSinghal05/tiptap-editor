import { useMemo, useState } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";

interface DocumentJsonPanelProps {
  // The editor's document; the JSON follows it until the user edits the JSON.
  doc: PMNode;
  editable: boolean;
  // Returns what stopped the edit, or null once it's applied.
  onApply: (json: string) => string[] | null;
}

// The open document as JSON, editable. Apply turns the edits into an
// ordinary editor change (same rules, undoable, counted as pending changes).
export const DocumentJsonPanel = ({ doc, editable, onApply }: DocumentJsonPanelProps) => {
  const current = useMemo(() => JSON.stringify(doc.toJSON(), null, 2), [doc]);
  // null while the JSON follows the editor.
  const [draft, setDraft] = useState<string | null>(null);
  // The editor's JSON when the draft was started.
  const [base, setBase] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const edited = draft !== null;
  const stale = edited && base !== current;

  const apply = () => {
    if (draft === null) return;
    const problems = onApply(draft);
    if (problems) {
      setErrors(problems);
    } else {
      setDraft(null);
      setErrors([]);
    }
  };

  const discard = () => {
    setDraft(null);
    setErrors([]);
  };

  return (
    <div className="panel-body doc-json">
      <div className="doc-json__toolbar">
        <span className={stale ? "doc-json__state doc-json__state--warn" : "doc-json__state"}>
          {!edited
            ? "Edit the document as JSON, then Apply."
            : stale
              ? "The document changed in the editor since you started. Apply replaces those changes."
              : "Edited, not applied yet."}
        </span>
        <button type="button" onClick={discard} disabled={!edited}>
          Discard
        </button>
        <button type="button" className="doc-json__apply" onClick={apply} disabled={!edited || !editable}>
          Apply
        </button>
      </div>
      {errors.length > 0 && (
        <div className="doc-json__errors" role="alert">
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <textarea
        className="doc-json__text"
        value={draft ?? current}
        readOnly={!editable}
        spellCheck={false}
        aria-label="Document JSON"
        onChange={(e) => {
          if (draft === null) setBase(current);
          setDraft(e.target.value);
          setErrors([]);
        }}
      />
    </div>
  );
};
