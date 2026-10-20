import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { HEADLINE_MAX_CHARS } from "@/lib/meeting/headlines";
import { VOICE_CORE } from "@/lib/voice/core";
import { PERSONAL_DETAIL_RULE } from "@/lib/voice/personal-detail";
import { requestJson } from "./model";

// EACH FUNCTIONAL AREA'S HEADLINE, FROM THE MEETING'S TRANSCRIPT
// (simplification review, change 13, the "transcript-headlines"
// switch; Jason, 2026-10-20).
//
// The meeting page's Headlines step has a box per functional area for
// the week (0288). In the room, people talk their headline through and
// often nobody types it. When the transcript is analysed, this asks
// for each area's update as it was said, and fills the boxes that are
// still empty.
//
// ---- WHAT IT MAY NOT DO -----------------------------------------
//
// It never writes over a person. A box with anything in it is left
// alone, whoever wrote it, so a headline typed in the room always
// wins. An area nobody talked about stays empty: an invented update
// on a page with an area's name against it is worse than a blank.
//
// It is best effort. A failed call, an unreadable answer or a refused
// write costs the headlines, never the meeting: the summary and the
// commitments are stored either way.
//
// ---- THE MARK -----------------------------------------------------
//
// A filled headline carries source_meeting_id, so the meeting page can
// say it came from the transcript. Any signed-in edit clears it (0292's
// stamp trigger), and the headline is then the person's.

type Admin = Awaited<ReturnType<typeof createSupabaseAdminClient>>;

export type HeadlineFunction = { id: string; title: string; lead: string | null };
export type ExtractedHeadline = { function_id: string; body: string };

// Long enough for the four parts said plainly; the box holds 4000.
export const HEADLINE_FROM_TRANSCRIPT_MAX = 1200;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["headlines"],
  properties: {
    headlines: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        required: ["function_id", "body"],
        properties: {
          function_id: {
            type: "string",
            description: "The id of the functional area, exactly as listed.",
          },
          body: {
            type: "string",
            description:
              "The area's update as it was given in the meeting: a few short sentences. Only what was said.",
          },
        },
      },
    },
  },
};

const SYSTEM = `You read a leadership team's weekly meeting transcript and write down each functional area's headline update, as it was given.

In these meetings each functional area gives a short update, usually by the person who leads it: what happened last week, what worked, what is coming up, and what the area needs support on.

WHAT TO WRITE FOR AN AREA
- Only what was said in the meeting about that area. Never add, guess or fill a gap.
- A few short sentences, in plain words, in the order it was said. Name people by name, as they are on the roster.
- Leave out its commitments and its numbers: the meeting covers those in their own steps. Keep a number only when it is part of the story ("we closed the two biggest quotes").

WHICH AREAS
- An area is in the list only if somebody gave its update or talked about its work. An area nobody spoke about is left out. An empty list is a fine answer.
- Use the area's id exactly as listed. Put each update under one area only; if it is unclear which area something belongs to, leave it out.

${PERSONAL_DETAIL_RULE}

${VOICE_CORE}`;

export function formatFunctions(fns: readonly HeadlineFunction[]): string {
  return [
    "<functional_areas>",
    ...fns.map((f) => `- ${f.title} (id: ${f.id})${f.lead ? `, led by ${f.lead}` : ""}`),
    "</functional_areas>",
  ].join("\n");
}

// The company's functional areas, with who leads each: the list the
// answer is held to. Archived areas are left out, as the meeting page
// leaves them out.
export async function loadHeadlineFunctions(admin: Admin, companyId: string): Promise<HeadlineFunction[]> {
  const { data, error } = await admin
    .from("functions")
    .select("id, title, lead_id")
    .eq("company_id", companyId)
    .eq("archived", false);
  if (error) {
    console.warn(`[headlines] functions unreadable for company ${companyId}: ${error.message}`);
    return [];
  }
  const rows = (data ?? []) as Array<{ id: string; title: string; lead_id: string | null }>;
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: people } = await admin.from("profiles").select("id, full_name").in("id", leadIds);
    for (const p of (people ?? []) as Array<{ id: string; full_name: string }>) names.set(p.id, p.full_name);
  }
  return rows.map((r) => ({ id: r.id, title: r.title, lead: r.lead_id ? names.get(r.lead_id) ?? null : null }));
}

// One call. Null when it did not run or could not be read; the caller
// treats that as "no headlines".
export async function extractHeadlines(
  client: Anthropic,
  input: {
    model: string;
    transcript: string;
    companyBlock: string;
    speakerBlock: string;
    functions: readonly HeadlineFunction[];
    onMessage?: (message: Anthropic.Message) => void;
  }
): Promise<ExtractedHeadline[] | null> {
  try {
    // Restating what was said, not reasoning: thinking off, or as low
    // as the model allows (transcripts/model.ts).
    const { data, message } = await requestJson(client, {
      model: input.model,
      max_tokens: 4000,
      system: SYSTEM,
      schema: SCHEMA,
      messages: [
        {
          role: "user",
          content:
            `${input.companyBlock}\n\n${formatFunctions(input.functions)}\n\n${input.speakerBlock}\n\n` +
            `<transcript>\n${input.transcript}\n</transcript>`,
        },
      ],
    });
    input.onMessage?.(message);
    if (data === null) {
      console.error(`[headlines] no JSON answer, stop_reason=${message.stop_reason}`);
      return null;
    }
    return validateHeadlines(data, input.functions.map((f) => f.id));
  } catch (err) {
    console.error("[headlines] extraction failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// Held to the listed areas: an id not on the list is dropped, the
// first update for an area wins, blanks go, and a long one is cut at a
// sentence where it can be.
export function validateHeadlines(raw: unknown, functionIds: readonly string[]): ExtractedHeadline[] {
  const list = (raw as { headlines?: unknown } | null)?.headlines;
  if (!Array.isArray(list)) return [];
  const allowed = new Set(functionIds);
  const seen = new Set<string>();
  const out: ExtractedHeadline[] = [];
  for (const item of list) {
    const id = (item as { function_id?: unknown })?.function_id;
    const body = (item as { body?: unknown })?.body;
    if (typeof id !== "string" || typeof body !== "string") continue;
    if (!allowed.has(id) || seen.has(id)) continue;
    const text = clip(body.replace(/\r\n?/g, "\n").trim());
    if (!text) continue;
    seen.add(id);
    out.push({ function_id: id, body: text });
  }
  return out;
}

function clip(text: string): string {
  const max = Math.min(HEADLINE_FROM_TRANSCRIPT_MAX, HEADLINE_MAX_CHARS);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  return end > max / 2 ? cut.slice(0, end + 1) : cut.trimEnd();
}

// Fills the week's empty boxes. An area with a headline already in it
// (anything but blank) is left alone; a blank one, which is what
// clearing the box leaves, is filled. Returns how many were written.
export async function fillMeetingHeadlines(
  admin: Admin,
  input: { companyId: string; meetingId: string; weekEnding: string; headlines: readonly ExtractedHeadline[] }
): Promise<number> {
  if (input.headlines.length === 0) return 0;
  const { data: existing, error } = await admin
    .from("meeting_headlines")
    .select("function_id, body")
    .eq("company_id", input.companyId)
    .eq("week_ending", input.weekEnding)
    .in("function_id", input.headlines.map((h) => h.function_id));
  if (error) {
    console.error(`[headlines] could not read the week's headlines: ${error.message}`);
    return 0;
  }
  const rows = (existing ?? []) as Array<{ function_id: string; body: string }>;
  const written = new Set(rows.filter((r) => r.body.trim() !== "").map((r) => r.function_id));
  const blank = new Set(rows.filter((r) => r.body.trim() === "").map((r) => r.function_id));
  let count = 0;
  for (const h of input.headlines) {
    if (written.has(h.function_id)) continue;
    const payload = { body: h.body, source_meeting_id: input.meetingId };
    // A blank row is only filled while it is still blank, so a person
    // typing into it at the same moment keeps their words.
    const { error: writeErr } = blank.has(h.function_id)
      ? await admin
          .from("meeting_headlines")
          .update(payload)
          .eq("function_id", h.function_id)
          .eq("week_ending", input.weekEnding)
          .eq("body", "")
      : await admin.from("meeting_headlines").insert({
          company_id: input.companyId,
          function_id: h.function_id,
          week_ending: input.weekEnding,
          ...payload,
        });
    if (writeErr) {
      // A unique clash means someone wrote this area's headline after
      // the read: theirs stands.
      console.warn(`[headlines] not filled for function ${h.function_id}: ${writeErr.message}`);
      continue;
    }
    count++;
  }
  return count;
}
