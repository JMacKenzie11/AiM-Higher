import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import {
  aboutAnotherVerdict,
  filterVerdict,
  declineMessageFor,
  MAX_DIRECTED_MEMORY_CHARS,
} from "./memory-shape";
import type { CoachTool } from "./tools";

// remember_this — the in-conversation half of person-added memory.
//
// The person says "remember that…" and the coach writes it down, then
// says what it saved. The saying-back matters as much as the saving:
// a record the person cannot see being made is a record they cannot
// correct, and this is the one write path a person triggers on
// purpose.
//
// ---- NO IDENTIFIER VOCABULARY ------------------------------------
//
// Same as memory_lookup, and for the same reason. The tool takes a
// line of text and nothing else. There is no person id, no subject,
// no "for" — no word in its schema meaning "somebody else". The
// definer function behind it forces profile_id := auth.uid() and
// takes no profile parameter, so even in an ABOUT-mode conversation,
// where the coach is discussing a team member by name, a directed
// memory lands on the CALLER. The leader can ask to be reminded of
// something about Marcus; nothing can put a row in Marcus's memory.
//
// ---- THE DECLINE -------------------------------------------------
//
// The never-written list applies to an explicit ask exactly as to a
// distilled one. The tool refuses in-band, returning status='declined'
// with the sentence to say, rather than throwing: the coach has to
// deliver this to a person who just asked for something, and an error
// would surface as a failure rather than an answer. Per the standing
// rule, tools do not throw for expected cases.
// ---- ABOUT ANOTHER PERSON -----------------------------------------
//
// In a conversation about a team member, an explicit ask is held to
// the same rule as a distilled memory (0252, Jason 2026-10-01): the
// asker's own plan is kept, a verdict on the other person is not.
// "Remember Marcus is unreliable" is declined; "Remember I'm talking
// to Marcus on Friday" is kept. Plain Aimee has no subject, so no
// name to hold it to (Jason, 2026-11-14).
export function makeRememberTool(opts: { subjectProfileId?: string | null } = {}): CoachTool {
  return {
    definition: {
      name: "remember_this",
      description:
        "Save something the person has explicitly asked you to remember, as a durable memory they can see and delete. " +
        "Use it ONLY on a clear request to remember, not because something seemed important: unprompted saving is what the end-of-conversation distillation is for. " +
        "Always tell them what you saved, in your own words, in the same reply. " +
        "Returns status='declined' with a message when the content is something the record never keeps (health, family and personal life, or a judgement about the person this conversation is about): say that message, do not save it another way, and offer what you can keep instead.",
      input_schema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              `The one thing to remember, in a single sentence under ${MAX_DIRECTED_MEMORY_CHARS} characters, written so it still makes sense read back in six months. Write the person's intent, not your paraphrase of the conversation around it.`,
          },
        },
        required: ["content"],
      },
    },
    handler: async (input) => {
      const raw = (input ?? {}) as { content?: string };
      const content = (raw.content ?? "").trim();
      if (content.length === 0) {
        return { status: "empty", note: "Nothing to save." };
      }
      if (content.length > MAX_DIRECTED_MEMORY_CHARS) {
        return {
          status: "too_long",
          note: `Memories are one sentence, under ${MAX_DIRECTED_MEMORY_CHARS} characters. Shorten it and try again.`,
        };
      }

      const verdict = filterVerdict(content);
      if (!verdict.keep) {
        return {
          status: "declined",
          reason: verdict.reason,
          message: declineMessageFor(verdict.reason),
        };
      }

      const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
      if (opts.subjectProfileId) {
        const { data: subject } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", opts.subjectProfileId)
          .maybeSingle<{ full_name: string | null }>();
        const full = (subject?.full_name ?? "").trim();
        const names = full ? [full, full.split(/\s+/)[0]] : [];
        const about = aboutAnotherVerdict(content, names);
        if (!about.keep) {
          return {
            status: "declined",
            reason: about.reason,
            message: declineMessageFor(about.reason),
          };
        }
      }
      const { data, error } = await supabase.rpc("record_coach_memory", {
        p_kind: "directed",
        p_content: content,
        p_conversation_ref: null,
      });
      if (error) {
        return {
          status: "error",
          note: "Could not save that just now. Tell them plainly rather than pretending it saved.",
        };
      }
      return { status: "saved", id: data as string, saved: content };
    },
  };
}
