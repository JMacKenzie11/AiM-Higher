// THE SIMPLIFICATION SWITCHES (Jason, 2026-10-19).
//
// The UX simplification review (claude.ai/artifact/JgZQRSufUS1tjhdgRbPgyR)
// ships as a set of changes, each behind its own switch, so any one of
// them can be turned off again without touching code. Old and new UI
// both stay in the source until Jason decides which changes stay; the
// ones that stay then lose their switch, the ones that go lose their
// new code.
//
// The switch is one environment variable, NEXT_PUBLIC_UI_SIMPLIFY: a
// comma-separated list of change names, or "all". Unset means every
// change is off, which is production until Jason turns them on there.
// NEXT_PUBLIC_ so the same value reaches server and browser code; it is
// inlined at build time, so changing it needs a redeploy (or a restart
// of `next dev`).
//
// CSS-only parts read the same list from <html data-simplify="...">,
// set in the root layout, as `:root[data-simplify~="name"] .x { }`.

export const SIMPLIFY_CHANGES = [
  // 1. One main action per page, placed top right of the first card.
  //    Every action stays a button: secondary ones drawn as text were
  //    tried and taken out (Jason, 2026-10-20: "I want them all to be
  //    buttons").
  "main-action",
] as const;

export type SimplifyChange = (typeof SIMPLIFY_CHANGES)[number];

function parse(raw: string | undefined): Set<SimplifyChange> {
  const names = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.includes("all")) return new Set(SIMPLIFY_CHANGES);
  return new Set(
    names.filter((n): n is SimplifyChange => (SIMPLIFY_CHANGES as readonly string[]).includes(n))
  );
}

// Read once: the value is fixed for the life of a build.
const ON = parse(process.env.NEXT_PUBLIC_UI_SIMPLIFY);

export function simplifyOn(change: SimplifyChange): boolean {
  return ON.has(change);
}

// For <html data-simplify>: the switched-on names, space-separated.
export function simplifyAttr(): string | undefined {
  return ON.size > 0 ? [...ON].join(" ") : undefined;
}

export const __test = { parse };
