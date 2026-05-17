import type { Editor } from "@tiptap/react";
import {
  MdFormatBold,
  MdFormatItalic,
  MdFormatUnderlined,
  MdStrikethroughS,
  MdFormatListBulleted,
  MdFormatListNumbered,
  MdFormatQuote,
  MdHorizontalRule,
  MdUndo,
  MdRedo,
  MdCode,
  MdFormatClear,
  MdClearAll,
  MdKeyboardReturn,
  MdAddBox,
  MdNoteAdd,
} from "react-icons/md";
import { RiH1, RiH2, RiH3, RiCodeBoxLine } from "react-icons/ri";

type BtnProps = {
  onClick: () => void;
  active?: boolean;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
};

const Btn = ({ onClick, active, title, disabled, children }: BtnProps) => (
  <button
    type="button"
    onMouseDown={(e) => {
      e.preventDefault();
      if (!disabled) onClick();
    }}
    title={title}
    disabled={disabled}
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 32,
      height: 32,
      border: "none",
      borderRadius: 6,
      cursor: disabled ? "not-allowed" : "pointer",
      background: active ? "#e2e8f0" : "transparent",
      color: active ? "#1e293b" : disabled ? "#cbd5e1" : "#475569",
      fontSize: 16,
    }}
  >
    {children}
  </button>
);

const Divider = () => (
  <span
    style={{
      width: 1,
      height: 20,
      background: "#e2e8f0",
      margin: "0 4px",
    }}
  />
);

interface ToolbarProps {
  editor: Editor;
  onAddSection: () => void;
  onAddClause: () => void;
}

export const Toolbar = ({ editor, onAddSection, onAddClause }: ToolbarProps) => {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 4,
        padding: 10,
        borderBottom: "1px solid #e2e8f0",
        background: "#fff",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <Btn onClick={() => editor.chain().focus().undo().run()} title="Undo">
        <MdUndo />
      </Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} title="Redo">
        <MdRedo />
      </Btn>

      <Divider />

      <Btn onClick={onAddSection} title="Add section (prompts for id)">
        <MdAddBox />
      </Btn>
      <Btn onClick={onAddClause} title="Add clause (prompts for tags)">
        <MdNoteAdd />
      </Btn>

      <Divider />

      <Btn
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        <RiH1 />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <RiH2 />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        <RiH3 />
      </Btn>

      <Divider />

      <Btn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold"
      >
        <MdFormatBold />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic"
      >
        <MdFormatItalic />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="Underline"
      >
        <MdFormatUnderlined />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough"
      >
        <MdStrikethroughS />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Inline code"
      >
        <MdCode />
      </Btn>

      <Divider />

      <Btn
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet list"
      >
        <MdFormatListBulleted />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Ordered list"
      >
        <MdFormatListNumbered />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <MdFormatQuote />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive("codeBlock")}
        title="Code block"
      >
        <RiCodeBoxLine />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
      >
        <MdHorizontalRule />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().setHardBreak().run()}
        title="Hard break"
      >
        <MdKeyboardReturn />
      </Btn>

      <Divider />

      <Btn
        onClick={() => editor.chain().focus().unsetAllMarks().run()}
        title="Clear marks"
      >
        <MdFormatClear />
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().clearNodes().run()}
        title="Clear nodes"
      >
        <MdClearAll />
      </Btn>
    </div>
  );
};
