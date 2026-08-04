"use client";

import { useEditor, EditorContent, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import styles from "./Editor.module.css";

// TipTap-based rich text editor. Client-side only — the editor bundle
// never ships to consumer pages, which render via the Renderer below
// using @tiptap/html's server-side generateHTML.
//
// Body is stored as TipTap JSON in classroom_trainings.body_json.
// StarterKit gives headings, bold/italic/strike/code, bullet + ordered
// lists, blockquote, hr, hard break — enough for training write-ups
// without a link extension (add later if authors ask).
//
// immediatelyRender:false is required under Next.js SSR to avoid a
// hydration mismatch — TipTap v3 documents this explicitly.

export type EditorJSON = JSONContent;

export function TipTapEditor({
  initial,
  onChange,
  placeholder,
}: {
  initial: EditorJSON | null;
  onChange: (json: EditorJSON) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: initial ?? emptyDoc(),
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON());
    },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: styles.editorSurface,
        "aria-label": placeholder ?? "Training body",
      },
    },
  });

  // Reset the editor when the initial content changes from outside
  // (e.g., navigating between trainings without a full remount).
  useEffect(() => {
    if (!editor) return;
    if (initial && editor.isEmpty) {
      editor.commands.setContent(initial);
    }
  }, [editor, initial]);

  if (!editor) {
    return <div className={styles.loading}>Loading editor…</div>;
  }

  return (
    <div className={styles.wrap}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function emptyDoc(): EditorJSON {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

// ------- Toolbar -------

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
      <ToolbarButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <s>S</s>
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        label="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        label="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </ToolbarButton>
      <ToolbarButton
        label="Blockquote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        label="Undo"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        ⟲
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        ⟳
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.toolbarButton}
      aria-label={label}
      title={label}
      data-active={active ? "true" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ToolbarSeparator() {
  return <span className={styles.toolbarSep} aria-hidden="true" />;
}
