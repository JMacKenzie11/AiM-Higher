import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/types";

// COUNTING REPLIES SHOWN WITH A VOICE RULE BROKEN (0244, 0254).
//
// Jason, 2026-09-29, wants to see how often it happens before deciding
// anything more. Every reply shown is checked against every rule in
// the voice check (voice-check.ts, COUNTED), and one still broken is
// counted here, by surface:
//
//   opener / debrief_reply / first_reply
//                            a held-back turn. It is sent back once
//                            for its own rules (SENT_BACK), and the
//                            better attempt is shown even when it
//                            still breaks one, so a reply never goes
//                            blank.
//   conversation             an ordinary Aimee reply, on the page or
//                            in the panel. It streams, so it is never
//                            retried. Dashes are taken out of every
//                            one (the saved text, and the shown text
//                            in ChatView).
//
// With the agent the conversation runs (0254), because a rule that is
// right for a coaching reply can be wrong for an agent's workflow step.
//
// Counted in voice_rule_breaks and read by `npm run aimee:uptake`, and
// said in the log. Rule names only, never the reply: coaching is
// private.

export type RuleBreakSurface = "debrief_reply" | "opener" | "first_reply" | "conversation";

export async function recordRuleBreak(
  supabase: SupabaseClient,
  args: {
    companyId: string | null;
    profileId: string;
    role: Role;
    conversationId: string;
    surface: RuleBreakSurface;
    origin?: "page" | "panel" | null;
    // The agent's registry key; null for plain Aimee.
    practiceId?: string | null;
    rules: string[];
  }
): Promise<void> {
  const rules = [...new Set(args.rules)].filter(Boolean);
  if (rules.length === 0) return;
  console.warn(
    `[aimee] ${args.surface} shown with a voice rule still broken (${args.conversationId}): ${rules.join(", ")}`
  );
  // portfolio_admin has no company of its own and writes only its four
  // tables (CLAUDE.md, Permissions); the log line above is its record.
  if (!args.companyId || args.role === "portfolio_admin") return;
  const { error } = await supabase.from("voice_rule_breaks").insert({
    company_id: args.companyId,
    profile_id: args.profileId,
    surface: args.surface,
    origin: args.surface === "conversation" ? (args.origin ?? "page") : null,
    practice_id: args.practiceId ?? null,
    rules,
  });
  if (error) {
    console.error("[aimee] rule break not recorded", { surface: args.surface, code: error.code, message: error.message });
  }
}
