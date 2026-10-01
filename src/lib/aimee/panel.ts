import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/types";

// AIMEE'S PANEL, the server half (docs/investigations/aimee-panel.md).
//
// A conversation started in the panel is an ordinary plain Aimee
// conversation with origin = 'panel' (0240). Two things follow from
// that column, both read from the ROW, never from where the person
// happens to be looking at it:
//
//   - it never writes coach memory: the sweep skips it
//     (memory-actions.ts) and the route leaves remember_this out of
//     its tools. Reading memory is allowed, so Aimee still knows them.
//   - Aimee is told she is in the panel (below): short answers, and
//     when it turns into real coaching, an offer to continue on the
//     Aimee page, in a NEW conversation, where memory works as it
//     always has. Never the same conversation, so its memory rules
//     never change halfway through.

export const CONTINUE_ON_PAGE_HREF = "/ask-aimee/new";

export const PANEL_PROMPT_BLOCK = [
  "<panel>",
  "This conversation is in your side panel, open beside the page the person is working on.",
  "Keep replies short: a few sentences, or a short list when there are steps.",
  "Nothing from this conversation goes into your memory of the person. If they ask you to remember something, say you cannot keep notes from the panel, and offer the Aimee page.",
  "When the conversation turns into real coaching (working through a situation with someone, a decision they are weighing, their own growth as a leader), offer once to carry on where you can remember what matters, with this exact link on its own line:",
  `[Continue on the Aimee page](${CONTINUE_ON_PAGE_HREF})`,
  "Say it starts a new conversation there, which opens with what they have told you so far, so they do not need to repeat it. Do not offer it for questions about using the app.",
  "</panel>",
].join("\n");

export type PanelEventKind = "opened" | "help_search" | "continue_on_page";

// Counts panel use for `npm run aimee:uptake`. Records that something
// happened and, for a search, whether it found anything. NEVER the
// query or anything on the page: a search can hold personal detail.
//
// Written under the person's own session: the insert policy admits
// only their own row, for a company they are in. portfolio_admin is
// skipped rather than refused, since its writes stay on its four
// tables (CLAUDE.md, Permissions). Fire and forget: a count that
// fails to land must never break the thing being counted.
export async function recordPanelEvent(
  supabase: SupabaseClient,
  args: {
    companyId: string | null;
    profileId: string;
    role: Role;
    kind: PanelEventKind;
    found?: boolean;
  }
): Promise<void> {
  if (!args.companyId || args.role === "portfolio_admin") return;
  const { error } = await supabase.from("aimee_panel_events").insert({
    company_id: args.companyId,
    profile_id: args.profileId,
    kind: args.kind,
    found: args.kind === "help_search" ? Boolean(args.found) : null,
  });
  if (error) {
    console.warn("aimee panel: event not recorded", { kind: args.kind, code: error.code });
  }
}
