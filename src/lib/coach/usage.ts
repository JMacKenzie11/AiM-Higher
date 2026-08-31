import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Anthropic API pricing per million tokens (USD). Update when
// Anthropic changes rates — the dashboard's per-company cost
// column is a direct sum of cost_usd_cents so a stale rate here
// shifts every future row. Rates as of 2026-01, keyed by the
// model IDs actually in use across the coach product.
//
// Fall back to the sonnet rate for unknown models rather than
// silently zeroing — under-reporting cost is worse than a small
// miscalibration.
type Rates = {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheCreatePerMillion: number;
  cacheReadPerMillion: number;
};

const MODEL_RATES: Record<string, Rates> = {
  "claude-sonnet-4-6": {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheCreatePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  "claude-opus-4-7": {
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
    cacheCreatePerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
  "claude-haiku-4-5": {
    inputPerMillion: 1.0,
    outputPerMillion: 5.0,
    cacheCreatePerMillion: 1.25,
    cacheReadPerMillion: 0.1,
  },
};

function ratesFor(model: string): Rates {
  // Match by prefix so a versioned id like "claude-sonnet-4-6-20260101"
  // still lands on the sonnet rate. Fall back to sonnet.
  const entry = Object.entries(MODEL_RATES).find(([k]) => model.startsWith(k));
  return entry?.[1] ?? MODEL_RATES["claude-sonnet-4-6"];
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

export function estimateCostCents(model: string, usage: UsageInput): number {
  const r = ratesFor(model);
  const dollars =
    ((usage.input_tokens ?? 0) * r.inputPerMillion +
      (usage.output_tokens ?? 0) * r.outputPerMillion +
      (usage.cache_creation_input_tokens ?? 0) * r.cacheCreatePerMillion +
      (usage.cache_read_input_tokens ?? 0) * r.cacheReadPerMillion) /
    1_000_000;
  return Math.round(dollars * 100);
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
  | "insights_analysis" // per-conversation Coaching insights summarizer
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
    const admin = createSupabaseAdminClient();
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
