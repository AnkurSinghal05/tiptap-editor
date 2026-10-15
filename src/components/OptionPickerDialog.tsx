import { useEffect, useState } from "react";
import type { TaxonomyOption } from "../editor/taxonomy";

interface OptionPickerDialogProps {
  open: boolean;
  title: string;
  hint?: string;
  options: TaxonomyOption[];
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

// Single-choice picker for fixed lists (verticals, workflow kinds).
export const OptionPickerDialog = ({
  open,
  title,
  hint,
  options,
  onConfirm,
  onCancel,
}: OptionPickerDialogProps) => {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (open) setSelected(options[0]?.value ?? null);
    // Only reset when the dialog opens; `options` is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          width: "min(420px, 90vw)",
          padding: 20,
          boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)",
          fontFamily: "sans-serif",
        }}
      >
        <h3 style={{ margin: "0 0 12px", fontSize: 16, color: "#0f172a" }}>{title}</h3>
        {hint && <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>{hint}</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {options.map((opt) => (
            <label
              key={opt.value}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}
            >
              <input
                type="radio"
                name="option-picker"
                value={opt.value}
                checked={selected === opt.value}
                onChange={() => setSelected(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>

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
            type="button"
            disabled={!selected}
            onClick={() => selected && onConfirm(selected)}
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
      </div>
    </div>
  );
};
