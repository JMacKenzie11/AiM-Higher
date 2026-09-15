import type { MemoryKind } from "./memory-shape";

// One place that turns a kind into the words a person reads.
//
// Extracted when 'directed' arrived and the ternary in MemoryList
// would have become a nested one, in a file that renders the same
// label the profile card renders. Two copies of this would drift, and
// the label IS the provenance promise: a person deciding whether to
// trust a line reads this before they read the line.
//
// Understated on purpose. "You asked me to remember" is a statement
// of fact, not a badge; a memory the person put there themselves
// needs less explaining than one Aimee worked out, not more.
export function memoryKindLabel(kind: MemoryKind): string {
  switch (kind) {
    case "said":
      return "You said";
    case "inferred":
      return "Aimee inferred";
    case "directed":
      return "You asked me to remember";
  }
}
