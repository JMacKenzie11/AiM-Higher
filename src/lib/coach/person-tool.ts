import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { todayInTimezone } from "@/lib/dates";
import { loadPersonRecord } from "./context";
import type { CoachTool } from "./tools";

// AIMEE LOOKS AT A NAMED PERSON (open data, phase F; Jason, 2026-10-01
// and 2026-10-03).
//
// In a plain conversation, on the Aimee page or in her panel, the
// person may ask about someone by name: "How is Priya doing this
// quarter?" She reads that person's record the way a Coach
// conversation reads its subject (loadPersonRecord), so the answer is
// what the asker could see on Priya's scorecard and nothing more.
//
// ---- THE MODEL GIVES A NAME, NEVER AN ID ------------------------
//
// The server turns the name into a person, among the people of THIS
// conversation's company that the caller can read. Two matches come
// back as a list of names to ask between; none comes back as none.
// The model never picks a row by id, so it cannot reach anyone the
// name does not lead to.
//
// ---- WHAT IT READS ----------------------------------------------
//
// The caller's own client, never the service client: RLS decides, as
// it does for every history tool (E5). It reads the shared record
// only. Nothing here touches anyone's Aimee conversations or memory,
// which stay private to their owner even though they are company data
// (investigation §5, guard 1). person-tool.test.ts holds the source to
// both.
//
// Registered for plain Aimee only (src/app/api/coach/route.ts). A
// Coach conversation stays on its one subject, so she cannot pull a
// second person in to compare, and agents keep their own focus.

const MAX_CANDIDATES = 8;

export type RosterPerson = {
  id: string;
  full_name: string;
  position: string | null;
  status: string | null;
};

export type NameMatch =
  | { kind: "one"; person: RosterPerson }
  | { kind: "several"; people: RosterPerson[] }
  | { kind: "none" };

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// A name to the people it could mean. A whole name that matches exactly
// wins outright. Otherwise every word given must be a word of the
// person's name or the start of one, at least three letters long ("Chris"
// for Christopher), or an initial beside another word ("Priya N"). So
// "Priya", "Priya N" and "Nair" find Priya Nair, and "P" alone finds
// nobody.
export function matchName(query: string, roster: readonly RosterPerson[]): NameMatch {
  const q = fold(query);
  if (!q) return { kind: "none" };
  const exact = roster.filter((p) => fold(p.full_name) === q);
  if (exact.length === 1) return { kind: "one", person: exact[0]! };
  if (exact.length > 1) return { kind: "several", people: exact };

  const words = q.split(" ");
  const hits = roster.filter((p) => {
    const parts = fold(p.full_name).split(" ");
    return words.every((w) =>
      parts.some(
        (part) => part === w || (part.startsWith(w) && (w.length >= 3 || (w.length === 1 && words.length > 1)))
      )
    );
  });
  if (hits.length === 1) return { kind: "one", person: hits[0]! };
  if (hits.length > 1) return { kind: "several", people: hits };
  return { kind: "none" };
}

export function makePersonRecordTool(args: { companyId: string }): CoachTool {
  return {
    definition: {
      name: "person_record",
      description:
        "Look up one person in this company by name and read their record: position, follow-through by quarter, missed and open commitments with their reasons, the priorities and goals they own, open issues they carry, and their strengths results when the company has strengths. It is what the person you are talking with could see on that person's scorecard. " +
        "Give the name as the person said it. Returns status='several' with the names when more than one person matches: ask which they mean, then look up the full name. Returns status='not_found' when nobody in the company has that name: say so, never guess. " +
        "Use it when the conversation needs facts about someone; it never includes anyone's conversations with Aimee.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "The person's name, as the person you are talking with said it." },
        },
        required: ["name"],
      },
    },
    handler: async (input) => {
      const name = typeof (input as { name?: unknown })?.name === "string" ? (input as { name: string }).name : "";
      if (!name.trim()) return { status: "not_found" as const, reason: "no name was given" };

      const db = await createSupabaseServerClient(getCurrentInstanceConfig());
      const [{ data: roster }, { data: company }] = await Promise.all([
        db.from("profiles").select("id, full_name, position, status").eq("company_id", args.companyId),
        db.from("companies").select("timezone").eq("id", args.companyId).maybeSingle<{ timezone: string | null }>(),
      ]);
      const match = matchName(name, (roster ?? []) as RosterPerson[]);

      if (match.kind === "none") return { status: "not_found" as const, name };
      if (match.kind === "several") {
        return {
          status: "several" as const,
          people: match.people.slice(0, MAX_CANDIDATES).map((p) => ({ name: p.full_name, position: p.position })),
        };
      }

      const { iso: todayIso } = todayInTimezone(company?.timezone ?? "UTC");
      const record = await loadPersonRecord(db, args.companyId, match.person.id, todayIso);
      if (!record) return { status: "not_found" as const, name };
      return {
        status: "ok" as const,
        name: match.person.full_name,
        position: match.person.position,
        deactivated: match.person.status === "deactivated" ? true : undefined,
        page: `/people/${match.person.id}`,
        record: record.personContext,
        strengths: record.strengthsContext ?? undefined,
      };
    },
  };
}
