import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { meetingDateIn } from "@/lib/transcripts/due-phrase";
import type { CoachTool } from "@/lib/coach/tools";

// The debrief agent's one tool: the meeting it was opened about.
//
// ============================================================
// SCOPE BOUNDARY, held to the line the other two tool files draw.
//
// This reads the SHARED ORGANIZATIONAL RECORD — a meeting and its
// analysis, both already on screen for this person at
// /leadership/meetings/[id]. It reads no conversation, no message,
// and nothing about a person beyond the names the analysis already
// prints.
//
// It reads the ANALYSIS, never the transcript. The summary is the
// company's record of the meeting and is what the champion is being
// invited to talk about; the raw transcript is every unedited thing
// anybody said, and handing that to a model whose output lands in a
// chat somebody else may later be shown is a different decision
// from the one being made here.
// ============================================================
//
// RLS APPLIES. The query runs on the CALLER'S client, so the tool
// returns what they could already open. A champion who is a
// team_member sees what a team_member sees, and no more.
//
// THE MEETING ID IS CLOSED OVER, not a parameter. It is stamped on
// the conversation at launch (0235) by the code that verified the
// nudge belongs to this person. The model is never asked to name a
// meeting, because identity is the wrong thing to trust a model
// with — RLS would refuse a cross-tenant read anyway, but "cannot
// name one" is stronger and cheaper than "would be caught".
//
// The tool never throws. A deleted meeting is a documented shape,
// not an error, so the agent can say the summary is gone and talk
// about the week instead.

export function buildGuideTools(args: {
  debriefingMeetingId?: string | null;
}): CoachTool[] {
  // Registered ONLY when there is a meeting pinned. An agent that
  // can always call it will call it in a conversation that has
  // nothing to fetch, get an empty answer, and open by apologising
  // for a summary that was never meant to be there.
  if (!args.debriefingMeetingId) return [];
  return [makeGetMeetingDebriefTool(args.debriefingMeetingId)];
}

function makeGetMeetingDebriefTool(meetingId: string): CoachTool {
  return {
    definition: {
      name: "get_meeting_debrief",
      description:
        "Read the summary of the meeting this conversation is about: " +
        "its date, title, the full written summary, and the " +
        "commitments that came out of it. Call this once, before " +
        "your first reply, so you are talking about what actually " +
        "happened rather than asking the leader to tell you.",
      input_schema: { type: "object", properties: {} },
    },
    handler: async () => {
      const db = await createSupabaseServerClient(getCurrentInstanceConfig());

      // `created_at`, not a meeting_date column — there isn't one.
      // The meeting's date is when it was ingested, resolved into
      // the company's clock, which is the same derivation
      // analyze.ts uses for every due date in the summary. Two
      // places disagreeing about what day a meeting happened is
      // exactly the contradiction the debrief is meant not to
      // produce.
      const { data: meeting } = await db
        .from("meetings")
        .select("id, meeting_title, created_at, company_id")
        .eq("id", meetingId)
        .maybeSingle<{
          id: string;
          meeting_title: string | null;
          created_at: string;
          company_id: string | null;
        }>();
      // RLS makes "gone" and "not yours" the same null, and they are
      // the same answer to give.
      if (!meeting) {
        return {
          found: false,
          note: "That meeting summary is no longer available.",
        };
      }

      const { data: analysis } = await db
        .from("meeting_analyses")
        .select("analysis_markdown, commitments_json, truncated, created_at")
        .eq("meeting_id", meetingId)
        .maybeSingle<{
          analysis_markdown: string;
          commitments_json: unknown;
          truncated: boolean | null;
          created_at: string;
        }>();

      const { data: company } = meeting.company_id
        ? await db
            .from("companies")
            .select("timezone")
            .eq("id", meeting.company_id)
            .maybeSingle<{ timezone: string }>()
        : { data: null };

      return {
        found: true,
        meeting_date: meetingDateIn(
          meeting.created_at,
          company?.timezone ?? "UTC"
        ),
        title: meeting.meeting_title,
        summary_markdown: analysis?.analysis_markdown ?? null,
        commitments: analysis?.commitments_json ?? [],
        // Said out loud rather than left for the agent to notice:
        // a summary that was cut off is missing sections, and an
        // agent that treats a missing section as "they didn't do
        // that" tells the leader something untrue about their
        // meeting.
        summary_was_cut_off: analysis?.truncated === true,
      };
    },
  };
}
