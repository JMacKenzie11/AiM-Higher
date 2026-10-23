"use client";

import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { pmDocToJson } from "./pm-json";
import styles from "./Editor.module.css";

// A small rich text editor for notes written in the room: bold,
// italic, bulleted and numbered lists, and links typed or pasted.
// TipTapEditor (Editor.tsx) is the classroom's, with headings, images
// and video, and uploads to the classroom's storage, none of which a
// page of meeting notes wants. Stored as TipTap JSON, like it.
//
// It reports the document on blur rather than on every keystroke, so
// the caller saves when the writer moves on, as the meeting's other
// fields do. Read-only when `editable` is false.

export type NotesDoc = JSONContent;

export function NotesEditor({
  initial,
  onBlur,
  editable = true,
  label,
}: {
  initial: NotesDoc | null;
  onBlur: (doc: NotesDoc) => void;
  editable?: boolean;
  label: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
          protocols: ["http", "https", "mailto"],
        },
      }),
    ],
    content: initial ?? { type: "doc", content: [{ type: "paragraph" }] },
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: styles.editorSurface,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
      },
    },
    // The classroom editor's walker, not getJSON(), which has dropped a
    // link's href on some TipTap 3 versions (see Editor.tsx).
    onBlur: ({ editor }) => onBlur(pmDocToJson(editor.state.doc)),
  });

  if (!editor) return <div className={styles.loading}>Loading the notes</div>;

  return (
    <div className={styles.wrap}>
      {editable ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
    }),
  });
  const button = (label: string, on: boolean, run: () => void, face: React.ReactNode) => (
    <button
      type="button"
      className={styles.toolbarButton}
      aria-label={label}
      title={label}
      aria-pressed={on}
      data-active={on ? "true" : undefined}
      // Keep the selection in the editor while the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {face}
    </button>
  );
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
      {button("Bold", active.bold, () => editor.chain().focus().toggleBold().run(), <strong>B</strong>)}
      {button("Italic", active.italic, () => editor.chain().focus().toggleItalic().run(), <em>I</em>)}
      <span className={styles.toolbarSep} aria-hidden="true" />
      {button("Bulleted list", active.bullets, () => editor.chain().focus().toggleBulletList().run(), "•")}
      {button("Numbered list", active.numbers, () => editor.chain().focus().toggleOrderedList().run(), "1.")}
    </div>
  );
}
