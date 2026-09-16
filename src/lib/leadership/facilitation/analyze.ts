import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { logCoachTokenUsage } from "@/lib/coach/usage";
import type {
  FacilitationDimension,
  FacilitationReview,
} from "./types";
import { FACILITATION_REVIEW_VERSION } from "./types";
import { isScoredReview } from "./scored";

// Second LLM pass on a meeting transcript. Runs after the summary +
// commitment-extraction pipeline, only when the routed company has
// the meeting_facilitation_review feature turned on.
//
// Contract: given the Anthropic client, the transcript, and the same
// context block the summarizer uses, return a typed FacilitationReview
// or null if the model can't produce one. Callers persist to
// meeting_analyses.facilitation_review_json.
//
// Structured output uses Anthropic tool-use — the model is forced to
// emit a single record_facilitation_review call whose input is our
// schema. That's more reliable than parsing markdown back into typed
// data, especially for a UI with distinct visual sections per field.
//
// The prompt is versioned on disk (prompt.v1.md); to iterate, bump to
// prompt.v2.md, extend the type shape, and add a version check in the
// renderer. DB stays schemaless so history is preserved.

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 3500;

type FacilitationInput = {
  transcript: string;
  companyContextBlock: string;
  model?: string;
};

// ONE RETRY, AND ONLY FOR AN UNSCORED ANSWER.
//
// About one review in ten comes back with a rich executive summary
// and no `dimensions` object at all — 3 of 29 on production when this
// was written. It is not an error, a refusal or a timeout: the call
// succeeds and the model simply omits a block that the tool schema
// already marks required. That is an intermittent formatting miss,
// which is the one kind of failure a second attempt actually fixes.
//
// WHY RETRYING HERE IS SAFE, and it is a property of where this sits
// rather than of this function. analyzeMeeting runs the facilitation
// pass BEFORE its first database write: the summary and extracted
// commitments are still in memory, meeting_analyses has not been
// inserted, and no commitment rows exist yet even when Automated
// Commitment Tracking is on. Retrying this call cannot duplicate any
// of them because none of them exist to duplicate. Re-running the
// WHOLE analysis is the dangerous version, and that is what the
// Re-analyze control does — with deletes in front of it for exactly
// this reason.
//
// ONE, not a loop. The cron route runs on maxDuration 300 and each
// meeting is already two model calls; a third on the failures is
// affordable, an unbounded retry on a busy pass is not.
//
// A second unscored answer changes nothing: the review is discarded
// and the meeting reads as having no review, which is where this
// stood before the retry existed. The retry can only improve the
// odds.
const FACILITATION_ATTEMPTS = 2;

export async function analyzeMeetingFacilitation(
  client: Anthropic,
  { transcript, companyContextBlock, model }: FacilitationInput
): Promise<FacilitationReview | null> {
  const systemPrompt = await loadFacilitationPrompt();
  const useModel =
    model || process.env.ANTHROPIC_FACILITATION_MODEL || DEFAULT_MODEL;

  for (let attempt = 1; attempt <= FACILITATION_ATTEMPTS; attempt += 1) {
    const review = await requestFacilitationReview(client, {
      systemPrompt,
      useModel,
      transcript,
      companyContextBlock,
      attempt,
    });
    if (review) return review;
  }
  return null;
}

// One attempt. Returns the review, or null when the model gave no
// tool call or gave one that scored nothing.
async function requestFacilitationReview(
  client: Anthropic,
  {
    systemPrompt,
    useModel,
    transcript,
    companyContextBlock,
    attempt,
  }: {
    systemPrompt: string;
    useModel: string;
    transcript: string;
    companyContextBlock: string;
    attempt: number;
  }
): Promise<FacilitationReview | null> {
  const response = await client.messages.create({
    model: useModel,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: systemPrompt }],
    tool_choice: { type: "tool", name: "record_facilitation_review" },
    tools: [FACILITATION_TOOL],
    messages: [
      {
        role: "user",
        content: `${companyContextBlock}\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
  });
  if (response.usage) {
    void logCoachTokenUsage({
      conversationId: null,
      // company_id isn't threaded through the facilitation entry
      // point; the caller (analyzeMeeting) has it but doesn't pass
      // it here. Logging without attribution beats not logging.
      companyId: null,
      // TAGGED BY ATTEMPT so two entries for one meeting read as a
      // retry rather than as a mystery. A cost review that cannot
      // tell a retry from a double-charge learns the wrong lesson.
      purpose: attempt === 1 ? "facilitation" : "facilitation_retry",
      model: useModel,
      usage: response.usage,
    });
  }

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) {
    console.error(
      `[facilitation] attempt ${attempt}/${FACILITATION_ATTEMPTS}: no tool call`
    );
    return null;
  }

  const raw = toolUse.input as Record<string, unknown>;
  const review = normalizeReview(raw);

  // A review that scored nothing is not a review. Returning null
  // stores null, which is what "the review did not run" already
  // means everywhere downstream — rather than a row that reads as
  // present and renders as dashes.
  //
  // The log names what the model actually sent, because the cause is
  // upstream of anything we can assert: `dimensions` is in the tool
  // schema's required list and was omitted anyway.
  if (!isScoredReview(review)) {
    console.error(
      `[facilitation] attempt ${attempt}/${FACILITATION_ATTEMPTS}: review scored nothing; discarding`,
      {
        keys: Object.keys(raw).sort(),
        dimensionsType: typeof raw.dimensions,
        insufficientTranscript: review.insufficient_transcript,
      }
    );
    return null;
  }

  return review;
}

// ----------------------------------------------------------------
// Tool schema — Anthropic tool-use input_schema mirrors FacilitationReview
// in types.ts. Keep the two in lock-step when iterating on the shape.
// ----------------------------------------------------------------

const FACILITATION_TOOL: Anthropic.Tool = {
  name: "record_facilitation_review",
  description:
    "Record the structured facilitation review of a leadership meeting. Emit exactly one call. Follow the generative-tone guardrails in the system prompt.",
  input_schema: {
    type: "object",
    required: [
      "insufficient_transcript",
      "executive_summary",
      "strengths",
      "growth_edges",
      "experiments",
      "fourws_audit",
      "dimensions",
      "agenda_adherence",
      "appreciation_moments",
      "generative_questions",
      "reframes",
    ],
    properties: {
      insufficient_transcript: {
        type: "boolean",
        description:
          "True when the transcript is too sparse to assess the meeting. When true, overall + all dimension scores must be null and missing_context should explain what's missing.",
      },
      missing_context: {
        type: ["string", "null"],
        description:
          "Optional. One-line explanation of what's missing when insufficient_transcript is true.",
      },
      overall: {
        type: ["integer", "null"],
        minimum: 0,
        maximum: 10,
        description:
          "Integer 0–10, or null when insufficient_transcript is true. Integrated read across dimensions, not a mean.",
      },
      executive_summary: {
        type: "string",
        description:
          "2–3 sentence read. Warm, specific to this meeting. If no meaningful analysis is possible, describe what's missing here as well.",
      },
      strengths: {
        type: "array",
        minItems: 0,
        maxItems: 6,
        items: {
          type: "object",
          required: ["title", "evidence"],
          properties: {
            title: {
              type: "string",
              description:
                "Short phrase naming what worked (e.g. 'Strong check-in tone').",
            },
            evidence: {
              type: "string",
              description:
                "One sentence tying it to something specific in the transcript.",
            },
          },
        },
      },
      growth_edges: {
        type: "array",
        minItems: 0,
        maxItems: 6,
        items: {
          type: "object",
          required: ["dimension", "title", "evidence", "why_it_matters"],
          properties: {
            dimension: {
              type: "string",
              enum: [
                "rhythm",
                "accountability",
                "alignment",
                "positive_framing",
              ],
            },
            title: {
              type: "string",
              description:
                "Short phrase framed as an opportunity, not a critique.",
            },
            evidence: {
              type: "string",
              description:
                "Cite the moment in the transcript. Depersonalize the subject (the meeting/the flow), not a named person.",
            },
            why_it_matters: {
              type: "string",
              description:
                "One sentence on the outcome improvement, not the deficit.",
            },
          },
        },
      },
      experiments: {
        type: "array",
        minItems: 0,
        maxItems: 5,
        items: {
          type: "object",
          required: ["action", "why", "next_step"],
          properties: {
            action: {
              type: "string",
              description:
                "The forward-looking experiment (e.g. 'Time-box functional updates to 4 minutes each').",
            },
            why: {
              type: "string",
              description:
                "Short outcome-focused reason. Never a critique of what didn't happen.",
            },
            next_step: {
              type: "string",
              description:
                "Concrete first move for next week's meeting.",
            },
          },
        },
      },
      fourws_audit: {
        type: "array",
        minItems: 0,
        maxItems: 10,
        description:
          "One row per issue the meeting worked through. Empty when no issues were discussed.",
        items: {
          type: "object",
          required: [
            "issue",
            "has_what",
            "has_want",
            "has_way",
            "has_who_when",
          ],
          properties: {
            issue: {
              type: "string",
              description: "Short name for the issue as it came up.",
            },
            has_what: { type: "boolean" },
            has_want: { type: "boolean" },
            has_way: { type: "boolean" },
            has_who_when: { type: "boolean" },
            note: {
              type: ["string", "null"],
              description:
                "Optional one-line coaching nudge on the step that didn't land. Depersonalized, forward-looking.",
            },
          },
        },
      },
      dimensions: {
        type: "object",
        required: [
          "rhythm",
          "accountability",
          "alignment",
          "positive_framing",
        ],
        properties: {
          rhythm: {
            type: "object",
            required: ["score", "notes"],
            properties: {
              score: {
                type: ["integer", "null"],
                minimum: 0,
                maximum: 10,
              },
              notes: { type: "string" },
            },
          },
          accountability: {
            type: "object",
            required: ["score", "notes"],
            properties: {
              score: {
                type: ["integer", "null"],
                minimum: 0,
                maximum: 10,
              },
              notes: { type: "string" },
            },
          },
          alignment: {
            type: "object",
            required: ["score", "notes"],
            properties: {
              score: {
                type: ["integer", "null"],
                minimum: 0,
                maximum: 10,
              },
              notes: { type: "string" },
            },
          },
          positive_framing: {
            type: "object",
            required: ["score", "notes"],
            description:
              "How well the meeting practised appreciative inquiry — celebrating wins, reframing problems as opportunities, asking generative questions vs. dwelling on deficits.",
            properties: {
              score: {
                type: ["integer", "null"],
                minimum: 0,
                maximum: 10,
              },
              notes: { type: "string" },
            },
          },
        },
      },
      appreciation_moments: {
        type: "array",
        minItems: 0,
        maxItems: 8,
        description:
          "Specific moments where the team celebrated a win, thanked someone, or acknowledged progress. Paraphrase the quote and add a one-line 'why this counts' context.",
        items: {
          type: "object",
          required: ["quote", "context"],
          properties: {
            quote: { type: "string" },
            context: { type: "string" },
          },
        },
      },
      generative_questions: {
        type: "array",
        minItems: 0,
        maxItems: 8,
        description:
          "Questions that opened new possibilities — future-oriented, curious, 'what would better look like', 'what if we', 'how might we'. NOT diagnostic questions ('why did that fail'). Paraphrase + one-line context.",
        items: {
          type: "object",
          required: ["quote", "context"],
          properties: {
            quote: { type: "string" },
            context: { type: "string" },
          },
        },
      },
      reframes: {
        type: "array",
        minItems: 0,
        maxItems: 8,
        description:
          "Moments where a problem was turned into an opportunity, or a complaint was reshaped into a want. Paraphrase + one-line context.",
        items: {
          type: "object",
          required: ["quote", "context"],
          properties: {
            quote: { type: "string" },
            context: { type: "string" },
          },
        },
      },
      agenda_adherence: {
        type: "object",
        required: ["score_out_of_5", "notes"],
        properties: {
          score_out_of_5: {
            type: ["integer", "null"],
            minimum: 0,
            maximum: 5,
            description:
              "How many of the five agenda sections the meeting meaningfully covered.",
          },
          notes: { type: "string" },
        },
      },
    },
  },
};

// ----------------------------------------------------------------
// Normalization — clamps ranges, drops junk items, ensures the
// shape is exactly FacilitationReview so renderers don't need defensive
// checks. The model's tool-use output is trusted for shape but not
// for staying within enum/range constraints.
// ----------------------------------------------------------------
function normalizeReview(raw: Record<string, unknown>): FacilitationReview {
  const insufficient = Boolean(raw.insufficient_transcript);
  const dims = {
    rhythm: normalizeDimensionScore(
      (raw.dimensions as Record<string, unknown> | undefined)?.rhythm,
      insufficient
    ),
    accountability: normalizeDimensionScore(
      (raw.dimensions as Record<string, unknown> | undefined)?.accountability,
      insufficient
    ),
    alignment: normalizeDimensionScore(
      (raw.dimensions as Record<string, unknown> | undefined)?.alignment,
      insufficient
    ),
    positive_framing: normalizeDimensionScore(
      (raw.dimensions as Record<string, unknown> | undefined)?.positive_framing,
      insufficient
    ),
  };

  // The model is instructed to give an integer `overall` whenever
  // insufficient_transcript is false, but occasionally emits null
  // anyway (usually when the meeting doesn't fit the AiMS agenda
  // and the model hedges). If we have real dimension scores, fall
  // back to their rounded mean so the list chip never reads as
  // "no review" when a review actually ran. When insufficient, we
  // force null — no invented score.
  let overall: number | null;
  if (insufficient) {
    overall = null;
  } else {
    const modelOverall = clampInt(raw.overall, 0, 10);
    if (modelOverall !== null) {
      overall = modelOverall;
    } else {
      const scored = [
        dims.rhythm.score,
        dims.accountability.score,
        dims.alignment.score,
        dims.positive_framing.score,
      ].filter((n): n is number => typeof n === "number");
      overall =
        scored.length > 0
          ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
          : null;
    }
  }

  return {
    version: FACILITATION_REVIEW_VERSION,
    insufficient_transcript: insufficient,
    missing_context:
      typeof raw.missing_context === "string" && raw.missing_context.trim()
        ? raw.missing_context.trim()
        : null,
    overall,
    executive_summary:
      typeof raw.executive_summary === "string"
        ? raw.executive_summary.trim()
        : "",
    strengths: normalizeStrengths(raw.strengths),
    growth_edges: normalizeGrowthEdges(raw.growth_edges),
    experiments: normalizeExperiments(raw.experiments),
    fourws_audit: normalizeFourWs(raw.fourws_audit),
    dimensions: dims,
    agenda_adherence: normalizeAgendaAdherence(
      raw.agenda_adherence,
      insufficient
    ),
    appreciation_moments: normalizeMoments(raw.appreciation_moments),
    generative_questions: normalizeMoments(raw.generative_questions),
    reframes: normalizeMoments(raw.reframes),
  };
}

function normalizeMoments(
  v: unknown
): NonNullable<FacilitationReview["appreciation_moments"]> {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null
    )
    .map((x) => ({
      quote: typeof x.quote === "string" ? x.quote.trim() : "",
      context: typeof x.context === "string" ? x.context.trim() : "",
    }))
    .filter((x) => x.quote.length > 0);
}

function clampInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function normalizeStrengths(v: unknown): FacilitationReview["strengths"] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null
    )
    .map((x) => ({
      title: typeof x.title === "string" ? x.title.trim() : "",
      evidence: typeof x.evidence === "string" ? x.evidence.trim() : "",
    }))
    .filter((x) => x.title.length > 0);
}

function normalizeGrowthEdges(
  v: unknown
): FacilitationReview["growth_edges"] {
  if (!Array.isArray(v)) return [];
  const validDim = new Set<FacilitationDimension>([
    "rhythm",
    "accountability",
    "alignment",
    "positive_framing",
  ]);
  return v
    .filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null
    )
    .map((x) => ({
      dimension: (validDim.has(x.dimension as FacilitationDimension)
        ? (x.dimension as FacilitationDimension)
        : "rhythm") as FacilitationDimension,
      title: typeof x.title === "string" ? x.title.trim() : "",
      evidence: typeof x.evidence === "string" ? x.evidence.trim() : "",
      why_it_matters:
        typeof x.why_it_matters === "string" ? x.why_it_matters.trim() : "",
    }))
    .filter((x) => x.title.length > 0);
}

function normalizeExperiments(v: unknown): FacilitationReview["experiments"] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null
    )
    .map((x) => ({
      action: typeof x.action === "string" ? x.action.trim() : "",
      why: typeof x.why === "string" ? x.why.trim() : "",
      next_step: typeof x.next_step === "string" ? x.next_step.trim() : "",
    }))
    .filter((x) => x.action.length > 0);
}

function normalizeFourWs(v: unknown): FacilitationReview["fourws_audit"] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null
    )
    .map((x) => ({
      issue: typeof x.issue === "string" ? x.issue.trim() : "",
      has_what: Boolean(x.has_what),
      has_want: Boolean(x.has_want),
      has_way: Boolean(x.has_way),
      has_who_when: Boolean(x.has_who_when),
      note:
        typeof x.note === "string" && x.note.trim().length > 0
          ? x.note.trim()
          : null,
    }))
    .filter((x) => x.issue.length > 0);
}

function normalizeDimensionScore(
  v: unknown,
  insufficient: boolean
): FacilitationReview["dimensions"]["rhythm"] {
  if (typeof v !== "object" || v === null) {
    return { score: null, notes: "" };
  }
  const row = v as Record<string, unknown>;
  return {
    score: insufficient ? null : clampInt(row.score, 0, 10),
    notes: typeof row.notes === "string" ? row.notes.trim() : "",
  };
}

function normalizeAgendaAdherence(
  v: unknown,
  insufficient: boolean
): FacilitationReview["agenda_adherence"] {
  if (typeof v !== "object" || v === null) {
    return { score_out_of_5: null, notes: "" };
  }
  const row = v as Record<string, unknown>;
  return {
    score_out_of_5: insufficient ? null : clampInt(row.score_out_of_5, 0, 5),
    notes: typeof row.notes === "string" ? row.notes.trim() : "",
  };
}

// ----------------------------------------------------------------
async function loadFacilitationPrompt(): Promise<string> {
  const file = path.join(
    process.cwd(),
    "src",
    "lib",
    "leadership",
    "facilitation",
    "prompt.v2.md"
  );
  return fs.readFile(file, "utf8");
}
