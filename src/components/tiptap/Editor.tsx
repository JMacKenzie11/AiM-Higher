"use client";

import { useEditor, EditorContent, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import { VideoEmbed } from "./nodes/VideoEmbed";
import { parseVideoUrl } from "@/lib/classroom/video-url";
import styles from "./Editor.module.css";

// TipTap-based rich text editor. Client-side only — the editor bundle
// never ships to consumer pages, which render via the Renderer using
// a JSON walker.
//
// Body is stored as TipTap JSON in classroom_trainings.body_json.
// StarterKit gives headings, bold/italic/strike/code, bullet + ordered
// lists, blockquote, hr, hard break. VideoEmbed is a custom node for
// inline YouTube / Vimeo videos (see nodes/VideoEmbed.ts).
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
    extensions: [StarterKit, VideoEmbed],
    content: initial ?? emptyDoc(),
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON());
    },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: styles.editorSurface,
        "aria-label": placeholder ?? "Section body",
      },
      // Auto-detect YouTube / Vimeo URLs pasted on a blank line and
      // convert them to a videoEmbed node. Users can still opt into
      // the raw-URL behavior by pasting mid-sentence (parse doesn't
      // fire on selection-non-empty).
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;
        const parsed = parseVideoUrl(text);
        if (!parsed) return false;
        // If we don't own the selection start, let the default
        // handler put the text where the user is typing.
        const { $from } = view.state.selection;
        if (!$from.parent.isTextblock || $from.parent.textContent.length > 0) {
          return false;
        }
        event.preventDefault();
        // insertVideoEmbed lives on our custom node's commands
        (editor as Editor | null)
          ?.chain()
          .focus()
          .insertVideoEmbed({
            provider: parsed.provider,
            videoId: parsed.id,
            caption: null,
          })
          .run();
        return true;
      },
    },
  });

  // Reset the editor when the initial content changes from outside
  // (e.g., navigating between sections without a full remount).
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
        label="Insert YouTube or Vimeo video"
        onClick={() => insertVideoPrompt(editor)}
      >
        ▶
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

// Explicit "Insert video" toolbar action. Prompts for the URL,
// parses it, and inserts a videoEmbed node. window.prompt is a
// spare UI on purpose — we can promote it to a proper dialog if
// authors ask for a caption field up-front.
function insertVideoPrompt(editor: Editor): void {
  const input = window.prompt(
    "Paste a YouTube or Vimeo video URL:",
    ""
  );
  if (!input) return;
  const parsed = parseVideoUrl(input);
  if (!parsed) {
    window.alert(
      "That URL doesn't look like a YouTube or Vimeo link. Try a share URL instead."
    );
    return;
  }
  editor
    .chain()
    .focus()
    .insertVideoEmbed({
      provider: parsed.provider,
      videoId: parsed.id,
      caption: null,
    })
    .run();
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
