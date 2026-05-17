import { useEffect, useRef, useState } from "react";

interface TagsDialogProps {
  open: boolean;
  title: string;
  initialTags?: string[];
  onConfirm: (tags: string[]) => void;
  onCancel: () => void;
}

export const TagsDialog = ({
  open,
  title,
  initialTags = [],
  onConfirm,
  onCancel,
}: TagsDialogProps) => {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTags(initialTags);
    setDraft("");
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // Intentionally only depend on `open` — otherwise the `initialTags`
    // default `[]` literal is a fresh reference each render and would
    // re-fire this effect on every keystroke, wiping the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const commitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (tags.includes(trimmed)) {
      setDraft("");
      return;
    }
    setTags((prev) => [...prev, trimmed]);
    setDraft("");
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      e.preventDefault();
      setTags((prev) => prev.slice(0, -1));
    }
  };

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
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>
          Press Enter or comma to add a tag. Backspace removes the last tag.
        </p>

        <div
          onClick={() => inputRef.current?.focus()}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            padding: 8,
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            minHeight: 44,
            cursor: "text",
            alignItems: "center",
          }}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "#e0e7ff",
                color: "#3730a3",
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`Remove tag ${tag}`}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "#3730a3",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitDraft}
            placeholder={tags.length === 0 ? "Add tags..." : ""}
            style={{
              flex: 1,
              minWidth: 80,
              border: "none",
              outline: "none",
              fontSize: 13,
              padding: 2,
            }}
          />
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
            onClick={() => {
              const trimmed = draft.trim();
              const finalTags = trimmed && !tags.includes(trimmed) ? [...tags, trimmed] : tags;
              onConfirm(finalTags);
            }}
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
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
