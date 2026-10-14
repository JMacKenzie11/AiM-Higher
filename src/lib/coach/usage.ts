import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Anthropic API pricing per million tokens (USD), from
// platform.claude.com/docs/en/about-claude/pricing as of 2026-10-14.
// Update when Anthropic changes rates: the dashboard's cost figures
// are a direct sum of cost_usd_cents, so a stale rate here shifts
// every future row. Cache writes are the 5-minute rate, which is the
// only one AiMS asks for.
//
// An unknown model is costed at the dearest rate in use (Opus 5.5)
// rather than zeroed or guessed low: under-reporting cost is worse
// than over-reporting it. Until 2026-10-14 the fallback was Sonnet 5,
// and the meeting pipeline's Opus 5.5 calls were logged at half
// their price.
type Rates = {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheCreatePerMillion: number;
  cacheReadPerMillion: number;
  // Haiku 5.5 charges more for a prompt over 100,000 tokens (input,
  // cache writes and cache reads all count). Each request is priced
  // on its own.
  longPrompt?: { overTokens: number; rates: Omit<Rates, "longPrompt"> };
};

// ORDER MATTERS. ratesFor matches by prefix, so a longer id goes above
// a shorter one that prefixes it: "claude-opus-5" prefixes
// "claude-opus-5-5", and "claude-sonnet-5" prefixes "claude-sonnet-5-5".
const MODEL_RATES: Array<[string, Rates]> = [
  // The meeting pipeline (transcripts/model.ts), since 2026-10-01.
  ["claude-opus-5-5", { inputPerMillion: 4, outputPerMillion: 20, cacheCreatePerMillion: 5, cacheReadPerMillion: 0.2 }],
  // Offered in the Agent Hub.
  ["claude-opus-5", { inputPerMillion: 5, outputPerMillion: 25, cacheCreatePerMillion: 6.25, cacheReadPerMillion: 0.5 }],
  ["claude-sonnet-5-5", { inputPerMillion: 2, outputPerMillion: 10, cacheCreatePerMillion: 2.5, cacheReadPerMillion: 0.1 }],
  // Aimee and most surfaces, since 2026-09-22.
  ["claude-sonnet-5", { inputPerMillion: 2, outputPerMillion: 10, cacheCreatePerMillion: 2.5, cacheReadPerMillion: 0.2 }],
  // Every small, fixed-shape call, since 2026-10-14 (it replaced Haiku
  // 4.5 at a tenth of the price).
  [
    "claude-haiku-5-5",
    {
      inputPerMillion: 0.1,
      outputPerMillion: 0.5,
      cacheCreatePerMillion: 0.125,
      cacheReadPerMillion: 0.01,
      longPrompt: {
        overTokens: 100_000,
        rates: { inputPerMillion: 0.5, outputPerMillion: 2.5, cacheCreatePerMillion: 0.625, cacheReadPerMillion: 0.05 },
      },
    },
  ],
  // Kept so rows logged before a move can be re-costed at what they
  // actually cost. Nothing writes these any more.
  ["claude-haiku-4-5", { inputPerMillion: 1, outputPerMillion: 5, cacheCreatePerMillion: 1.25, cacheReadPerMillion: 0.1 }],
  ["claude-sonnet-4-6", { inputPerMillion: 3, outputPerMillion: 15, cacheCreatePerMillion: 3.75, cacheReadPerMillion: 0.3 }],
  ["claude-opus-4-7", { inputPerMillion: 5, outputPerMillion: 25, cacheCreatePerMillion: 6.25, cacheReadPerMillion: 0.5 }],
];

const FALLBACK_MODEL = "claude-opus-5-5";

function ratesFor(model: string): Rates {
  const entry = MODEL_RATES.find(([k]) => model.startsWith(k));
  return entry?.[1] ?? MODEL_RATES.find(([k]) => k === FALLBACK_MODEL)![1];
}

// Accept both `undefined` and `null` on the cache-token fields
// because Anthropic's Usage type marks them nullable, while a
// hand-built accumulator object typically uses undefined defaults.
// Coerce both to 0 in the cost math.
export type UsageInput = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

// In cents, to four decimal places (0285). Whole cents rounded every
// Haiku call to zero, so a feature that ran thousands of times a
// month showed as free.
export function estimateCostCents(model: string, usage: UsageInput): number {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const base = ratesFor(model);
  const r =
    base.longPrompt && input + cacheCreate + cacheRead > base.longPrompt.overTokens ? base.longPrompt.rates : base;
  const dollars =
    (input * r.inputPerMillion +
      output * r.outputPerMillion +
      cacheCreate * r.cacheCreatePerMillion +
      cacheRead * r.cacheReadPerMillion) /
    1_000_000;
  return Math.round(dollars * 100 * 10_000) / 10_000;
}

// Purpose enum mirrors the CHECK constraint on coach_token_usage.purpose
// (migration 0136). The name "coach" in the type/function/table is a
// historical artifact — every platform model call logs here now.
export type CoachUsagePurpose =
  | "turn" // coach conversation turn
  | "title" // coach conversation auto-title
  | "themes" // nightly themes clustering cron
  | "analyzer" // meeting transcript analysis
  | "rd" // role description generator + recommend
  | "strengths" // strengths assessment narrative / results / team insights
  | "brief" // dashboard "Week in review" brief
  | "clarity" // commitment clarity, measure critique, measure target check
  | "facilitation" // leadership facilitation review
  | "facilitation_retry" // that review's second attempt, when the
  // first came back having scored nothing. Its own purpose so two
  // rows for one meeting read as a retry rather than a double-charge.
  | "insights_analysis" // per-conversation Coaching insights summarizer
  | "memory" // coach memory: distilling a finished conversation
  // The meeting calls that were never logged until 0285, each under
  // its own name so a cost review can see what a meeting costs.
  | "speakers" // who was speaking (transcripts/speakers.ts)
  | "coverage" // commitments the extraction may have missed
  | "questions" // the meeting's questions for next week
  | "invitation" // the Guide's invitation card (guide/headline.ts)
  | "principles_check" // Agent Hub: a prompt checked against the coaching principles
  | "session_brief" // HQ session brief
  | "other";

// Fire-and-forget log. Callers should NOT await this in the
// hot path — errors are swallowed with a warn so a logging
// hiccup can never break a user-visible response. The dashboard
// treats missing rows as "not measured" rather than surfacing
// an error, which matches the semantics we want.
export async function logCoachTokenUsage(args: {
  conversationId: string | null;
  companyId: string | null;
  purpose: CoachUsagePurpose;
  model: string;
  usage: UsageInput;
}): Promise<void> {
  try {
    const cost = estimateCostCents(args.model, args.usage);
    const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
    await admin.from("coach_token_usage").insert({
      conversation_id: args.conversationId,
      company_id: args.companyId,
      purpose: args.purpose,
      model: args.model,
      input_tokens: args.usage.input_tokens ?? 0,
      output_tokens: args.usage.output_tokens ?? 0,
      cache_creation_input_tokens: args.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: args.usage.cache_read_input_tokens ?? 0,
      cost_usd_cents: cost,
    });
  } catch (err) {
    console.warn("logCoachTokenUsage failed", err);
  }
}

// A logger for one purpose, for a model call made somewhere that has
// no company or conversation of its own to log against: the caller
// builds it and passes it down (the shape rewordWithModel takes).
export function usageLogger(args: {
  conversationId?: string | null;
  companyId: string | null;
  purpose: CoachUsagePurpose;
  model: string;
}): (message: { usage?: UsageInput | null }) => void {
  return (message) => {
    if (!message.usage) return;
    void logCoachTokenUsage({
      conversationId: args.conversationId ?? null,
      companyId: args.companyId,
      purpose: args.purpose,
      model: args.model,
      usage: message.usage,
    });
  };
}
