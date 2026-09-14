import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import type { CoachTool } from "./tools";

// memory_lookup — the recall tool.
//
// ---- HOW THIS SITS AGAINST THE TIER-ONE SCOPE BOUNDARY -----------
//
// The history tools read the shared organizational record and are
// explicitly forbidden from reading conversations. Memory IS
// conversation-derived, so it is worth being exact about why this is
// not the boundary being crossed.
//
// Tier two's open question is whether the coach may read what was
// SAID IN CONVERSATIONS — including, potentially, other people's, and
// including a leader's about-mode session about a report. That
// question is still open and this does not answer it.
//
// What this reads is the caller's OWN distilled memory, written from
// their own general-mode conversations, readable by nobody else on
// the platform including system_admin. It is the person's own record,
// returned to the person it is about. No mode boundary is crossed
// because a leader's about-mode conversation produces no memory at
// all.
//
// ---- NO IDENTIFIER VOCABULARY ------------------------------------
//
// The tool takes a query and a timeframe. It takes no person id, no
// subject, no scope — there is no word in its schema for "somebody
// else". RLS is what makes that structural rather than polite:
// coach_memories admits `profile_id = auth.uid()` and nothing else,
// so this query returns the caller's rows however it is called, and
// a bug in this file cannot widen it.

const MAX_RESULTS = 15;
const MAX_DAYS = 730;

export function makeMemoryLookupTool(): CoachTool {
  return {
    definition: {
      name: "memory_lookup",
      description:
        `Search what you remember about this person from previous conversations — including memories older than the ones already in your context, which decay out of the default block but stay here. Up to ${MAX_RESULTS} results. ` +
        "Optionally filter by a free-text query (matched against the memory text) and by how far back to look. " +
        "Each result carries a kind: 'said' means the person stated it and you may recall it plainly; 'inferred' means you concluded it, and it must be offered tentatively or not at all — never as a fact about them. " +
        "Returns status='empty' when there is nothing to recall; say so rather than implying a history that is not there.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Words to match against remembered text. Omit to get the most recent memories.",
          },
          days_back: {
            type: "integer",
            description: `How far back to look, in days. 1-${MAX_DAYS}. Omit for all of it.`,
          },
        },
        required: [],
      },
    },
    handler: async (input) => {
      const raw = (input ?? {}) as { query?: string; days_back?: number };
      const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

      let q = supabase
        .from("coach_memories")
        // No profile filter, and that is the point: RLS admits only
        // `profile_id = auth.uid()`, so there is no id in this file
        // at all for a bug to get wrong.
        .select("kind, content, created_at")
        .order("created_at", { ascending: false })
        .limit(MAX_RESULTS);

      const days =
        typeof raw.days_back === "number" && Number.isFinite(raw.days_back)
          ? Math.min(MAX_DAYS, Math.max(1, Math.floor(raw.days_back)))
          : null;
      if (days !== null) {
        q = q.gte(
          "created_at",
          new Date(Date.now() - days * 86_400_000).toISOString()
        );
      }

      const term = raw.query?.trim();
      if (term) {
        // Escape the LIKE wildcards a person's own words might carry,
        // so "50% done" searches for that and not for anything.
        const safe = term.replace(/[%_\\]/g, (c) => `\\${c}`);
        q = q.ilike("content", `%${safe}%`);
      }

      const { data, error } = await q;
      if (error) {
        // Never throw: an error read as an absence is how a coach
        // tells somebody there is no history when there is.
        console.error("memory_lookup failed", { code: error.code });
        return { status: "error" as const, message: "Couldn't read memory." };
      }
      const rows = (data ?? []) as Array<{
        kind: string;
        content: string;
        created_at: string;
      }>;
      if (rows.length === 0) {
        return {
          status: "empty" as const,
          reason: term
            ? "nothing remembered matching that"
            : "nothing remembered yet",
        };
      }
      return {
        status: "ok" as const,
        memories: rows.map((r) => ({
          kind: r.kind,
          content: r.content,
          remembered_on: r.created_at.slice(0, 10),
        })),
      };
    },
  };
}
