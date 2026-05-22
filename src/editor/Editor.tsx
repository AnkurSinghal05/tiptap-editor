import { useRef, useState } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Image } from "@tiptap/extension-image";
import { TextAlign } from "@tiptap/extension-text-align";

import { CustomDocument } from "./extensions/CustomDocument";
import { Section } from "./extensions/Section";
import { Clause } from "./extensions/Clause";
import { CustomHeading } from "./extensions/CustomHeading";
import { generateClauseId, generateSectionId } from "./utils/ids";
import { initialContent } from "./initialContent";
import { Toolbar } from "./Toolbar";
import { TagsDialog } from "../components/TagsDialog";

type Tab = "render" | "json";

export const Editor = () => {
  const [showTagsDialog, setShowTagsDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("render");
  const [jsonText, setJsonText] = useState(JSON.stringify(initialContent, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [html, setHtml] = useState("");
  const pendingInsertPosRef = useRef<number | null>(null);

  // True while the editor is being updated from a JSON edit. Prevents the
  // editor's onUpdate from overwriting (reformatting) the JSON the user is
  // actively typing.
  const isApplyingJsonRef = useRef(false);

  // Ref-based callback keeps the extension's option stable while letting
  // React state setters be invoked through the closure below.
  const requestClauseAtRef = useRef<(pos: number) => void>(() => {});
  requestClauseAtRef.current = (pos: number) => {
    pendingInsertPosRef.current = pos;
    setShowTagsDialog(true);
  };

  const editor = useEditor({
    extensions: [
      CustomDocument,
      Section,
      Clause,
      StarterKit.configure({ document: false, heading: false }),
      CustomHeading.configure({
        onRequestClauseAt: (pos: number) => {
          requestClauseAtRef.current(pos);
          return true;
        },
      }),
      Underline,
      Image,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: initialContent,
    onCreate: ({ editor }) => {
      setHtml(editor.getHTML());
      setJsonText(JSON.stringify(editor.getJSON(), null, 2));
    },
    onUpdate: ({ editor }) => {
      setHtml(editor.getHTML());
      // When the change originated from a JSON edit, leave the textarea as the
      // user typed it; only editor-originated changes resync the JSON text.
      if (!isApplyingJsonRef.current) {
        setJsonText(JSON.stringify(editor.getJSON(), null, 2));
      }
    },
  });

  if (!editor) return null;

  const findAncestorEnd = (typeName: string): number | null => {
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === typeName) {
        return $from.after(d);
      }
    }
    return null;
  };

  const handleAddSection = () => {
    const idInput = window.prompt("Section id:", generateSectionId());
    if (idInput === null) return;
    const id = idInput.trim() || generateSectionId();

    const sectionEnd = findAncestorEnd("section");
    const newSection = {
      type: "section",
      attrs: { id },
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "New section" }],
        },
      ],
    };

    if (sectionEnd === null) {
      editor.chain().focus().insertContent(newSection).run();
    } else {
      editor
        .chain()
        .insertContentAt(sectionEnd, newSection)
        .setTextSelection(sectionEnd + 2)
        .focus()
        .run();
    }
  };

  const handleAddClause = () => {
    const pos = findAncestorEnd("clause") ?? findAncestorEnd("heading");
    if (pos === null) {
      window.alert("Place the cursor inside a section to add a clause.");
      return;
    }
    pendingInsertPosRef.current = pos;
    setShowTagsDialog(true);
  };

  const handleTagsConfirm = (tags: string[]) => {
    setShowTagsDialog(false);
    const pos = pendingInsertPosRef.current;
    pendingInsertPosRef.current = null;
    if (pos === null) return;

    editor
      .chain()
      .insertContentAt(pos, {
        type: "clause",
        attrs: { id: generateClauseId(), tags },
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

  const handleJsonChange = (value: string) => {
    setJsonText(value);

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }

    isApplyingJsonRef.current = true;
    try {
      // emitUpdate: true so the Render preview (html) also reflects JSON edits.
      editor.commands.setContent(parsed as JSONContent, true);
      setJsonError(null);
    } catch (err) {
      setJsonError(
        err instanceof Error ? err.message : "JSON does not match the editor schema",
      );
    } finally {
      isApplyingJsonRef.current = false;
    }
  };

  return (
    <>
      <div className="workspace">
        <div className="panel">
          <div className="panel-header">Editor</div>
          <Toolbar
            editor={editor}
            onAddSection={handleAddSection}
            onAddClause={handleAddClause}
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
          </div>

          {activeTab === "render" ? (
            <div
              className="panel-body render-surface"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <div className="json-pane">
              <textarea
                className="panel-body json-surface"
                value={jsonText}
                spellCheck={false}
                onChange={(e) => handleJsonChange(e.target.value)}
              />
              <div className={jsonError ? "json-status json-status--error" : "json-status"}>
                {jsonError ? `⚠ ${jsonError}` : "✓ Synced with editor"}
              </div>
            </div>
          )}
        </div>
      </div>

      <TagsDialog
        open={showTagsDialog}
        title="Tags for new clause"
        onConfirm={handleTagsConfirm}
        onCancel={handleTagsCancel}
      />
    </>
  );
};
