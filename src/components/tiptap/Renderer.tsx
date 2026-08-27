import type { JSONContent } from "@tiptap/react";
import type { ClassroomVideoProvider } from "@/lib/classroom/types";
import { VideoEmbedPlayer } from "./VideoEmbedPlayer";
import styles from "./Renderer.module.css";

// Server component that renders a Tiptap JSON body as React. Walks
// the tree ourselves rather than using @tiptap/html's generateHTML
// + dangerouslySetInnerHTML — the walker lets us render our
// videoEmbed node as a real React component (VideoEmbedPlayer)
// instead of a placeholder div that would need client-side
// hydration. StarterKit nodes still render as plain semantic tags.
//
// Keep the switch in lockstep with the editor's extensions. If a
// new StarterKit-derived node is enabled (e.g. Link, Highlight),
// add a case here or its content will silently vanish.

export function TipTapRenderer({ json }: { json: JSONContent | null }) {
  if (!json) return null;
  return <div className={styles.prose}>{renderNode(json, "root")}</div>;
}

function renderNode(node: JSONContent, key: string): React.ReactNode {
  const children = (node.content ?? []).map((child, i) =>
    renderNode(child, `${key}.${i}`)
  );

  switch (node.type) {
    case "doc":
      return <>{children}</>;

    case "paragraph":
      return <p key={key}>{children}</p>;

    case "heading": {
      const level = clampHeadingLevel(node.attrs?.level as number | undefined);
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag key={key}>{children}</Tag>;
    }

    case "bulletList":
      return <ul key={key}>{children}</ul>;

    case "orderedList":
      return (
        <ol key={key} start={(node.attrs?.start as number | undefined) ?? 1}>
          {children}
        </ol>
      );

    case "listItem":
      return <li key={key}>{children}</li>;

    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;

    case "codeBlock":
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      );

    case "horizontalRule":
      return <hr key={key} />;

    case "hardBreak":
      return <br key={key} />;

    case "text":
      return renderText(node, key);

    case "videoEmbed": {
      const provider = node.attrs?.provider as ClassroomVideoProvider | undefined;
      const videoId = node.attrs?.videoId as string | undefined;
      const caption = (node.attrs?.caption as string | null | undefined) ?? null;
      if (!videoId || (provider !== "youtube" && provider !== "vimeo")) {
        return null;
      }
      return (
        <VideoEmbedPlayer
          key={key}
          provider={provider}
          videoId={videoId}
          caption={caption}
        />
      );
    }

    case "image": {
      const src = node.attrs?.src as string | undefined;
      const alt = (node.attrs?.alt as string | null | undefined) ?? "";
      const width = node.attrs?.width as number | null | undefined;
      if (!src) return null;
      const style =
        typeof width === "number"
          ? { width: `${width}%`, height: "auto" as const }
          : undefined;
      // eslint-disable-next-line @next/next/no-img-element
      return <img key={key} src={src} alt={alt} style={style} />;
    }

    default:
      // Unknown node — skip its wrapper but render children so a
      // future extension that we haven't taught the renderer about
      // still surfaces its text content instead of vanishing.
      return <>{children}</>;
  }
}

// Text nodes carry an optional marks[] array that Tiptap uses for
// inline formatting. Wrap the text with the corresponding tags
// from innermost to outermost.
function renderText(node: JSONContent, key: string): React.ReactNode {
  const text = node.text ?? "";
  const marks = (node.marks ?? []) as Array<{ type: string }>;
  let element: React.ReactNode = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        element = <strong>{element}</strong>;
        break;
      case "italic":
        element = <em>{element}</em>;
        break;
      case "strike":
        element = <s>{element}</s>;
        break;
      case "code":
        element = <code>{element}</code>;
        break;
      // Unknown marks are ignored so unknown-mark text still
      // renders as plain text rather than blanking out.
    }
  }
  return <span key={key}>{element}</span>;
}

function clampHeadingLevel(input: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
  if (typeof input !== "number") return 2;
  if (input < 1) return 1;
  if (input > 6) return 6;
  return input as 1 | 2 | 3 | 4 | 5 | 6;
}
