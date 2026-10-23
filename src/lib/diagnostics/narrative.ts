import { stripEmDashes } from "@/lib/voice/strip-dashes";
import { READOUT_SECTIONS, type Narrative, type ReadoutSection } from "./types";
import { numbersIn, readoutFigures, type ReadoutData } from "./readout";

// THE READOUT WRITER'S RULES, without the call. Pure so the number
// guard and the schema are tested with no model and no database
// (narrative.test.ts); the call is in narrative-call.ts.
//
// The module computes every figure and the model writes words around
// them. The schema puts the evidence before the paragraph in every
// section, as the facilitation review learned to, and the numbers
// guard drops any paragraph that states a number the input did not
// carry, so a figure on the page cannot disagree with hours-back.ts.

export const NARRATIVE_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    READOUT_SECTIONS.map((s) => [
      s.key,
      {
        type: "object",
        properties: {
          evidence: { type: "array", items: { type: "string" } },
          paragraph: { type: "string" },
        },
        required: ["evidence", "paragraph"],
      },
    ])
  ),
  required: READOUT_SECTIONS.map((s) => s.key),
};

// The numbers in `text` that are not among the readout's figures.
export function foreignNumbers(text: string, figures: readonly string[]): string[] {
  const allowed = new Set(figures.map((f) => String(Number(f))));
  return numbersIn(text).filter((n) => !allowed.has(n));
}

// Setting a thing against what it is not ("not just time saved, but",
// "measured, not a guess"): the habit the voice rules ban and the model
// keeps reaching for in a report. Narrow on purpose, so it fires only on
// the shapes that are always the habit; a hit asks for the text again.
const DENIAL = [/\bnot (?:just|only|merely|simply)\b/gi, /,\s*not (?:a|an|one|the|just)\b[^.,;]*/gi];

export function findDenials(text: string): Array<{ phrase: string; context: string }> {
  const hits: Array<{ phrase: string; context: string }> = [];
  for (const re of DENIAL) {
    for (const m of text.matchAll(re)) {
      hits.push({ phrase: m[0].replace(/^,\s*/, "").trim(), context: text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30) });
    }
  }
  return hits;
}

export type NarrativeCheck = { narrative: Narrative; dropped: ReadoutSection[]; foreign: Partial<Record<ReadoutSection, string[]>> };

// Keeps each section's paragraph when it is plain words around the
// input's figures, and drops it otherwise. A dropped section stays
// empty for the lead to write.
export function checkNarrative(data: unknown, r: ReadoutData): NarrativeCheck {
  const figures = readoutFigures(r);
  const narrative: Narrative = {};
  const dropped: ReadoutSection[] = [];
  const foreign: NarrativeCheck["foreign"] = {};
  for (const { key } of READOUT_SECTIONS) {
    const raw = (data as Record<string, { paragraph?: unknown }> | null)?.[key]?.paragraph;
    const paragraph = typeof raw === "string" ? stripEmDashes(raw).replace(/\s+/g, " ").trim().slice(0, 1500) : "";
    if (!paragraph) continue;
    const extra = foreignNumbers(paragraph, figures);
    if (extra.length > 0) {
      dropped.push(key);
      foreign[key] = extra;
      continue;
    }
    narrative[key] = paragraph;
  }
  return { narrative, dropped, foreign };
}

// What the model reads: the assembled readout without the map's dots,
// the figures it may use, and the owner's own words from kickoff.
// The map's and Hours Back's figures go in under names that say what
// each one counts, so the model cannot read every task's hours as the
// candidates' hours, or the recovery rate as a share of the map.
//
// With a Systems and AI Snapshot (phase 4) the seventh section is that,
// under names that say what each figure counts, built from the
// readout's summary alone: counts and tool names, never who uses what.
export function narrativeInput(r: ReadoutData, ownerWords: string | null): string {
  const { map, hoursBack, narrative: _narrative, systems, guardrails, ...rest } = r;
  void _narrative;
  return JSON.stringify({
    figures_you_may_use: readoutFigures(r),
    owner_words_at_kickoff: ownerWords,
    readout: {
      ...rest,
      ...(systems
        ? {
            systems_and_ai_snapshot: {
              systems: systems.map.systems.map((x) => ({ name: x.name, kind: x.kind })),
              connections_where_information_is_carried_by_hand_top_three: systems.handCarried.map((c) => ({
                from: c.from,
                to: c.to,
                what_moves: c.whatMoves,
                hours_a_week_spent_carrying_it: c.hours,
              })),
              hours_a_week_spent_carrying_information_by_hand_across_every_connection: systems.handCarriedHours,
              ai_use: {
                people_who_answered_the_ai_questions: systems.ai.answered,
                people_using_any_ai_tool_for_work: systems.ai.usingAny,
                people_using_a_tool_they_found_themselves: systems.ai.usingPersonal,
                tools_and_how_many_people_use_each: systems.ai.tools.map((t) => ({ tool: t.tool, people: t.users })),
                tool_uses_the_company_provided: systems.ai.companyProvided,
                tool_uses_people_found_themselves: systems.ai.personal,
              },
              guardrail_rules: guardrails.rules,
              data_at_risk: guardrails.dataAtRisk,
            },
          }
        : { guardrails }),
      map: {
        tasks_mapped: map.tasks,
        hours_a_week_on_all_mapped_tasks: map.totalHours,
        draining_routine_tasks: map.candidates,
        hours_a_week_on_draining_routine_tasks: map.candidateHours,
        hours_a_week_volume_checked: map.checkedHours,
      },
      hours_back: {
        measured_hours_a_week_from_the_first_win: hoursBack.measured,
        projected_further_hours_a_week_from_the_other_candidates: hoursBack.projected,
        // A share of the first win's own task, not of the map.
        recovery_rate_share_of_the_first_win_task_hours_given_back: hoursBack.recoveryRate,
        guarantee_hours_a_week_for_one_person: hoursBack.guaranteeHours,
        guarantee_met: hoursBack.guaranteeMet,
      },
    },
  });
}
