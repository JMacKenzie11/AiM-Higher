import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

// DID THE EXTRACTION MISS ANYTHING?
//
// ---- WHY A SEPARATE STEP -----------------------------------------
//
// Recall is the one property the extraction cannot check about
// itself. Asking the same call to both extract and confirm it
// extracted everything gets you a model agreeing with itself.
//
// The alternative considered and rejected was restructuring
// extraction into two passes plus a check. Measured recall was
// already complete on three real meetings, so that would have
// tripled cost and latency to solve a problem the evidence did not
// show — and added two more places for the kind of silent null that
// cost a day on the speaker map. This is the cheap half of that
// proposal: the check, on its own.
//
// ---- WHAT IT IS FOR, AND WHAT IT IS NOT --------------------------
//
// It reports. It does not add commitments. A miss is a line in a
// weekly number, looked at by a person, not a row that appears on
// somebody's list because a second model thought it should.
//
// That distinction is the whole design. An extraction that quietly
// invents work is far worse than one that quietly drops it, because
// the dropped one is still in the transcript and the invented one is
// on a page with somebody's name against it.

export type CoverageMiss = {
  // The transcript's own words. Quoted so a reader can judge in one
  // glance whether it is really a commitment, without opening the
  // recording.
  quote: string;
  speaker: string | null;
  // Why it reads as a commitment: who would do it, and what.
  reason: string;
};

export type CoverageReport = {
  missed: CoverageMiss[];
  checked: number;
};

const TOOL: Anthropic.Tool = {
  name: "record_coverage",
  description:
    "Record commitments present in the transcript that are missing from the extracted list.",
  input_schema: {
    type: "object",
    required: ["missed"],
    properties: {
      missed: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          // Quote first: the verdict follows from the words, not the
          // other way round.
          required: ["quote", "reason", "speaker"],
          properties: {
            quote: {
              type: "string",
              description:
                "The transcript's own words, verbatim and short. If you cannot quote it, it is not a miss.",
            },
            speaker: {
              type: ["string", "null"],
              description: "Who said it, from the speaker map. Null when unknown.",
            },
            reason: {
              type: "string",
              description:
                "One sentence: who would do what. Not an argument for including it — just what it is.",
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You check whether a list of extracted commitments missed anything.

You are given a transcript and the commitments already extracted from it. Find the ones that are missing.

WHAT COUNTS AS A COMMITMENT
- Somebody said they would do something: "I'll", "I'm going to", "let me", "I can get that".
- Somebody was given something to do and did not refuse it: "X is going to", "can you", answered with agreement.

WHAT DOES NOT
- An idea nobody took: "we should probably look at that" with no owner and no agreement.
- A decision with no action attached.
- Something already on the extracted list in different words. Read the list properly before calling anything missing — the same commitment is often phrased differently, and reporting it again is noise that teaches people to ignore this check.

RULES
- Quote the transcript. If you cannot quote it, it is not a miss.
- An empty list is a good answer and the common one. Do not find something to say.
- You are not adding these to anything. A person reads them.`;

export async function checkCoverage(
  client: Anthropic,
  input: {
    model: string;
    transcript: string;
    extracted: string[];
    speakerBlock: string;
  }
): Promise<CoverageReport | null> {
  try {
    const list =
      input.extracted.length > 0
        ? input.extracted.map((d, i) => `${i + 1}. ${d}`).join("\n")
        : "(none were extracted)";
    const response = await client.messages.create({
      model: input.model,
      // Reading and comparing, not reasoning. Thinking consumed the
      // whole budget and emitted nothing on the analysis call; see
      // the note in analyze.ts.
      thinking: { type: "disabled" },
      max_tokens: 3000,
      system: [{ type: "text", text: SYSTEM }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_coverage" },
      messages: [
        {
          role: "user",
          content:
            `${input.speakerBlock}\n\n<already_extracted>\n${list}\n</already_extracted>\n\n` +
            `<transcript>\n${input.transcript}\n</transcript>`,
        },
      ],
    });
    const block = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!block) {
      console.error(
        `[coverage] no tool_use block — stop_reason=${response.stop_reason}`
      );
      return null;
    }
    const missed = normaliseMissed(block.input);
    if (!missed) {
      console.error("[coverage] could not read the result");
      return null;
    }
    console.log(
      `[coverage] ${missed.length} possible miss(es) against ${input.extracted.length} extracted`
    );
    return { missed, checked: input.extracted.length };
  } catch (err) {
    console.error(
      "[coverage] check failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// The same shape-tolerance the speaker map needed, for the same
// reason: a tool call may arrive as an array, an object keyed by
// something, or a JSON string. Rejecting the shape loses the result
// silently, which is how the speaker map failed three times.
function normaliseMissed(input: unknown): CoverageMiss[] | null {
  let raw = (input as { missed?: unknown } | null)?.missed;
  for (let depth = 0; typeof raw === "string" && depth < 2; depth++) {
    try {
      const inner: unknown = JSON.parse(raw);
      raw =
        inner && typeof inner === "object" && "missed" in inner
          ? (inner as { missed: unknown }).missed
          : inner;
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) return raw as CoverageMiss[];
  if (raw && typeof raw === "object") {
    return Object.values(raw as Record<string, unknown>) as CoverageMiss[];
  }
  return null;
}
