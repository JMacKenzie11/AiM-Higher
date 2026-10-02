import fs from "node:fs/promises";
import path from "node:path";

// THE AiMS COACHING PRINCIPLES (prompts/aims-coaching-principles.md).
//
// One file, Jason's text word for word (2026-09-30), read into every
// Aimee conversation: on the Aimee page, in the panel, in every agent,
// and in the invitations Aimee writes (guide/headline.ts). It comes
// after an agent's own prompt and takes precedence over it, as its
// first paragraph says, so the coaching is the same wherever she is.
// The voice rules and the panel's own block still come after it: they
// are about form, not about how to coach.
//
// Read once per process; the file only changes with a deploy.
let cached: Promise<string> | null = null;

export function loadCoachingPrinciples(): Promise<string> {
  cached ??= fs
    .readFile(path.join(process.cwd(), "prompts", "aims-coaching-principles.md"), "utf8")
    .then((t) => t.trim());
  return cached;
}
