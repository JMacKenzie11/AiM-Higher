// Contract between the practice prompt and the client renderer.
// When the assistant emits a fenced code block tagged `script` with
// a JSON payload of this shape, the client renders it as a card
// instead of raw markdown. Practices that don't need a card just
// never emit the block.

export type ScriptLine = {
  speaker: string;
  line: string;
};

export type PracticeScript = {
  title: string;
  unproductive_exchange: ScriptLine[];
  what_went_wrong: string[];
  better_approach: string;
  why_this_works: string;
};

// Parse a raw string that is (or is expected to be) the payload of
// a `script` fenced code block. Returns null on any shape mismatch
// or JSON parse failure so the caller can fall back to raw text —
// the practice framework never crashes on a malformed model output.
export function parsePracticeScript(raw: string): PracticeScript | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const betterApproach =
    typeof parsed.better_approach === "string" ? parsed.better_approach.trim() : "";
  const whyThisWorks =
    typeof parsed.why_this_works === "string" ? parsed.why_this_works.trim() : "";
  if (!title || !betterApproach || !whyThisWorks) return null;

  const exchange = Array.isArray(parsed.unproductive_exchange)
    ? parsed.unproductive_exchange
        .map((item: unknown): ScriptLine | null => {
          if (!isRecord(item)) return null;
          if (typeof item.speaker !== "string" || typeof item.line !== "string")
            return null;
          const speaker = item.speaker.trim();
          const line = item.line.trim();
          if (!speaker || !line) return null;
          return { speaker, line };
        })
        .filter((v): v is ScriptLine => v !== null)
    : [];

  const whatWentWrong = Array.isArray(parsed.what_went_wrong)
    ? parsed.what_went_wrong
        .map((v: unknown) => (typeof v === "string" ? v.trim() : ""))
        .filter((s: string) => s.length > 0)
    : [];

  if (exchange.length === 0 || whatWentWrong.length === 0) return null;

  return {
    title,
    unproductive_exchange: exchange,
    what_went_wrong: whatWentWrong,
    better_approach: betterApproach,
    why_this_works: whyThisWorks,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
