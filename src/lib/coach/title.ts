// Strip markdown, wrapping quotes, and trailing sentence punctuation
// from a model-produced conversation title. The prompt asks the model
// for plain text, but Sonnet/Haiku still wrap titles in **bold**
// frequently enough that we saw "**From Blame to What's Working**"
// reach the DB. Belt-and-suspenders — the strip is cheap and titles
// are pure UI.
//
// Lives in its own module rather than inside actions.ts so route.ts
// (server, not "use server") can import it without pulling in the
// server-action machinery.
export function cleanGeneratedTitle(raw: string): string {
  return raw
    .trim()
    .replace(/[*_`#]/g, "")
    .replace(/^["'“”‘’]|["'“”‘’]$/g, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

// The title a conversation gets before anybody has said anything.
//
// Moved out of actions.ts for the reason the header above gives: a
// "use server" module can only export async functions, so nothing
// that is not an action can live there and still be imported. The
// render-safe creator in create-general.ts needs it, and so does
// the action.
export function defaultTitleForToday(): string {
  const now = new Date();
  const label = now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Coaching · ${label}`;
}
