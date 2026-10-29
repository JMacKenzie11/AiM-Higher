import type { AiUseRow, ParticipantRow, SystemLinkRow, SystemRow, TaskRow } from "./types";

// A 10-person front office for the systems tests: an ERP, email, a
// quoting spreadsheet and an accounting system; orders typed from email
// into the ERP and invoices typed from the quote sheet into accounting
// (both retyped), and the ERP feeding accounting automatically.
//
//   Email > ERP          retyped    order entry, 6 (checked) + 4 hours
//   Quote sheet > Books  retyped    invoicing 3, and 2 copied the other way
//   ERP > Books          automatic  1 hour still copied by hand
//   Email > Quote sheet  no link    quoting, 6 hours (unlinked)
//
// AI: two use ChatGPT (one found it, one was given it), one uses
// Copilot, one said none, one was not asked, and one tool belongs to
// somebody whose survey is not entered yet.

export const ERP = "s-erp", EMAIL = "s-email", SHEET = "s-sheet", BOOKS = "s-books";

const system = (id: string, name: string, kind: SystemRow["kind"]): SystemRow => ({
  id,
  diagnostic_id: "dx",
  name,
  kind,
  holds: null,
  owner_name: null,
  notes: null,
  created_at: "2026-10-01T00:00:00Z",
});

const link = (id: string, from: string, to: string, what: string, how: SystemLinkRow["how"]): SystemLinkRow => ({
  id,
  diagnostic_id: "dx",
  from_system_id: from,
  to_system_id: to,
  what_moves: what,
  how,
  notes: null,
  created_at: "2026-10-01T00:00:00Z",
});

const person = (n: number, surveyed = true, noAi = false): ParticipantRow => ({
  id: `p${n}`,
  diagnostic_id: "dx",
  name: `Person ${n}`,
  role_title: n <= 3 ? "Estimator" : "Office coordinator",
  email: null,
  years_with_company: null,
  survey_entered_at: surveyed ? "2026-10-02T00:00:00Z" : null,
  in_conversations: false,
  conversation_at: null,
  created_at: "2026-10-01T00:00:00Z",
  uses_no_ai: noAi,
});

const task = (id: string, participant: number, title: string, hours: number, extra: Partial<TaskRow> = {}): TaskRow => ({
  id,
  diagnostic_id: "dx",
  participant_id: `p${participant}`,
  title,
  hours_per_week: hours,
  energy: 2,
  judgment: 2,
  source: "survey",
  volume_units_per_week: null,
  minutes_per_unit: null,
  data_risk: "low",
  build_effort_hours: 3,
  candidate_override: null,
  canonical_title: null,
  created_at: "2026-10-01T00:00:00Z",
  system_id: null,
  copies_from_system_id: null,
  copies_to_system_id: null,
  role_title: null,
  frequency: null,
  build_effort: null,
  needs_approval: null,
  agent_type: null,
  ...extra,
});

const copies = (from: string, to: string) => ({ system_id: to, copies_from_system_id: from, copies_to_system_id: to });

const ai = (id: string, participant: number, tool: string, provided: AiUseRow["provided_by"], usedFor: string): AiUseRow => ({
  id,
  participant_id: `p${participant}`,
  tool,
  provided_by: provided,
  used_for: usedFor,
  frequency: "weekly",
  never_share: "Customer pricing",
  created_at: "2026-10-02T00:00:00Z",
});

export function frontOffice() {
  return {
    systems: [system(ERP, "Epicor", "erp"), system(EMAIL, "Outlook", "email"), system(SHEET, "Quote sheet", "spreadsheet"), system(BOOKS, "QuickBooks", "accounting")],
    links: [
      link("l1", EMAIL, ERP, "Orders", "retyped"),
      link("l2", SHEET, BOOKS, "Invoices", "retyped"),
      link("l3", ERP, BOOKS, "Shipped orders", "automatic"),
    ],
    participants: [person(1), person(2), person(3), person(4, true, true), person(5), person(6), person(7), person(8), person(9), person(10, false)],
    tasks: [
      task("t1", 1, "Quoting", 6, copies(EMAIL, SHEET)),
      // Checked: 30 a week at 12 minutes is 6 hours, not the 5 reported.
      task("t2", 2, "Order entry", 5, { ...copies(EMAIL, ERP), volume_units_per_week: 30, minutes_per_unit: 12 }),
      task("t3", 3, "Order entry", 4, copies(EMAIL, ERP)),
      task("t4", 4, "Invoicing", 3, copies(SHEET, BOOKS)),
      task("t5", 5, "Price updates", 2, copies(BOOKS, SHEET)),
      task("t6", 6, "Shipping fixes", 1, copies(ERP, BOOKS)),
      task("t7", 7, "Scheduling", 8, { system_id: ERP, energy: 4, judgment: 4 }),
      task("t8", 8, "Phones", 5),
      task("t9", 9, "Filing", 2),
      task("t10", 10, "Supplier calls", 3),
    ],
    aiUse: [
      ai("a1", 1, "ChatGPT", "personal", "Rewording quote emails for Person 1's customers"),
      ai("a2", 2, "chatgpt ", "company", "Summarising long supplier threads"),
      ai("a3", 3, "Copilot", "company", "Drafting replies"),
      ai("a4", 10, "Gemini", "personal", "Not surveyed yet"),
    ],
  };
}
