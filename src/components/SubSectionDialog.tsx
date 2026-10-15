import { useEffect, useRef, useState } from "react";
import { SUBSECTION_TYPES, type SubSectionType } from "../editor/taxonomy";

export interface NewSubSection {
  type: SubSectionType;
  id: string;
  name: string;
}

interface SubSectionDialogProps {
  open: boolean;
  // `type:id` keys already used in the target section.
  existingKeys: Set<string>;
  onConfirm: (value: NewSubSection) => void;
  onCancel: () => void;
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#475569",
  margin: "10px 0 4px",
};

// Type and id identify the subsection and can't be changed after creation;
// the name becomes its title, editable until the first save.
export const SubSectionDialog = ({ open, existingKeys, onConfirm, onCancel }: SubSectionDialogProps) => {
  const [type, setType] = useState<SubSectionType>(SUBSECTION_TYPES[0].value);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setType(SUBSECTION_TYPES[0].value);
    setId("");
    setName("");
    setError(null);
    const frame = requestAnimationFrame(() => idRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const trimmedId = id.trim();
    const trimmedName = name.trim();
    if (!trimmedId) return setError("Id is required.");
    if (!trimmedName) return setError("Name is required.");
    if (existingKeys.has(`${type}:${trimmedId}`)) {
      return setError(`A ${type} with id "${trimmedId}" already exists in this section.`);
    }
    onConfirm({ type, id: trimmedId, name: trimmedName });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add subsection"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{
          background: "#fff",
          borderRadius: 10,
          width: "min(420px, 90vw)",
          padding: 20,
          boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)",
          fontFamily: "sans-serif",
        }}
      >
        <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#0f172a" }}>Add subsection</h3>
        <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
          Type and id can't be changed later. The name is the title and can be edited until the subsection is saved.
        </p>

        <label style={labelStyle}>
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as SubSectionType)}
            style={{ ...fieldStyle, marginTop: 4 }}
          >
            {SUBSECTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          Id
          <input
            ref={idRef}
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="e.g. PTR-0042"
            style={{ ...fieldStyle, marginTop: 4 }}
          />
        </label>

        <label style={labelStyle}>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Partner Golf Course"
            style={{ ...fieldStyle, marginTop: 4 }}
          />
        </label>

        {error && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#b91c1c" }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              border: "1px solid #cbd5e1",
              background: "#fff",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            style={{
              padding: "6px 14px",
              border: "none",
              background: "#4f46e5",
              color: "#fff",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Add
          </button>
        </div>
      </form>
    </div>
  );
};
