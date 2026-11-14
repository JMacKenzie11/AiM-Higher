// A title nobody chose: "Coaching · Aug 10" (about and plain
// conversations) or "Aug 10" (agents, whose name carries the rest).
// Automatic titles replace only these, so a rename is respected.
// Shared by the route's first-exchange title and the client-fired
// auto-title action, so the two cannot disagree on what a rename is.
export const DEFAULT_TITLE = /^(?:Coaching · )?[A-Z][a-z]+ \d{1,2}$/;

export function isDefaultTitle(title: string | null | undefined): boolean {
  return !title || DEFAULT_TITLE.test(title);
}
