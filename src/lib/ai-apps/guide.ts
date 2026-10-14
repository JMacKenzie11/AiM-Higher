// THE HOW-TO-CONNECT GUIDE, split for the drawer (Jason, 2026-10-14).
//
// The steps live in one place, docs/help/ai-apps.md, which Aimee's
// help search reads too. The drawer never carries its own copy: it
// asks the server for that article, already cut to the person's role,
// feature fences and instance address by the help loader, and this
// splits it into one part per app. No imports, so the client can use
// the types.

export type AiAppId = "claude" | "chatgpt";

// The apps on the approved list (0280), in the order the dropdown
// shows them, each matched to its "## " heading in the article.
export const AI_APPS: ReadonlyArray<{ id: AiAppId; heading: string }> = [
  { id: "claude", heading: "Claude" },
  { id: "chatgpt", heading: "ChatGPT" },
];

export function isAiAppId(v: unknown): v is AiAppId {
  return AI_APPS.some((a) => a.id === v);
}

export type AiAppsGuide =
  // MCP is off here, or the person's role cannot connect one.
  | { state: "closed" }
  // Switched off for their company: what to do instead.
  | { state: "off"; intro: string; off: string }
  | { state: "on"; intro: string; apps: Array<{ id: AiAppId; label: string; markdown: string }> };

// The article after the loader has filtered it. The intro is what
// comes before the first "## "; each app is its "## " section.
export function splitAiAppsGuide(markdown: string): Omit<AiAppsGuide, "state"> & {
  intro: string;
  off: string | null;
  apps: Array<{ id: AiAppId; label: string; markdown: string }>;
} {
  const parts = markdown.split(/^## /m);
  const intro = parts[0].replace(/^# .*$/m, "").trim();
  let off: string | null = null;
  const apps: Array<{ id: AiAppId; label: string; markdown: string }> = [];
  for (const part of parts.slice(1)) {
    const nl = part.indexOf("\n");
    const label = (nl < 0 ? part : part.slice(0, nl)).trim();
    const body = (nl < 0 ? "" : part.slice(nl + 1)).trim();
    if (/switched off/i.test(label)) {
      off = body;
      continue;
    }
    const app = AI_APPS.find((a) => label.startsWith(a.heading));
    if (app) apps.push({ id: app.id, label, markdown: body });
  }
  return { intro, off, apps };
}
