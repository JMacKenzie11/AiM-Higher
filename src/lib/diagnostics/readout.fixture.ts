import type { DiagnosticBundle, DiagnosticRow, NoteRow, ParticipantRow, QuoteRow, TaskRow, WinRow } from "./types";

// One engagement for the readout tests: a small front office, its
// tasks, notes and quotes, and a first win with its measured week.

const person = (id: string, name: string, role: string | null): ParticipantRow => ({
  id,
  diagnostic_id: "dx",
  name,
  role_title: role,
  email: null,
  years_with_company: null,
  survey_entered_at: "2026-10-01T00:00:00Z",
  in_conversations: true,
  conversation_at: null,
  created_at: "2026-10-01T00:00:00Z",
});

let n = 0;
const task = (participant: string, title: string, hours: number, energy: number, judgment: number, extra: Partial<TaskRow> = {}): TaskRow => ({
  id: `t${++n}`,
  diagnostic_id: "dx",
  participant_id: participant,
  title,
  hours_per_week: hours,
  energy,
  judgment,
  source: "survey",
  volume_units_per_week: null,
  minutes_per_unit: null,
  data_risk: "low",
  build_effort_hours: 3,
  candidate_override: null,
  canonical_title: null,
  created_at: "2026-10-01T00:00:00Z",
  ...extra,
});

const note = (participant: string, body: string, wish: string | null, hours: number | null): NoteRow => ({
  participant_id: participant,
  body,
  peak_experience: null,
  redeploy_wish: wish,
  destination_hours: hours,
});

const quote = (id: string, text: string, approved: string | null, participant: string | null = null): QuoteRow => ({
  id,
  participant_id: participant,
  text,
  approved_at: approved,
  created_at: "2026-10-05T00:00:00Z",
});

export function readoutBundle(overrides: Partial<DiagnosticRow> = {}, firstWin: Partial<WinRow> | null = {}): DiagnosticBundle {
  n = 0;
  const tasks = [
    task("p1", "Quotes", 8, 1, 2, { canonical_title: "Quoting", volume_units_per_week: 24, minutes_per_unit: 25 }),
    task("p2", "quoting", 6, 2, 2, { canonical_title: "Quoting" }),
    task("p2", "Order entry", 5, 1, 1, { canonical_title: "Order entry" }),
    task("p3", "Entering orders", 7, 2, 1, { canonical_title: "Order entry" }),
    task("p3", "Shared inbox", 6, 2, 2, { build_effort_hours: 8 }),
    task("p4", "Supplier follow-up", 3, 2, 2),
    task("p4", "Production planning", 10, 4, 5),
  ];
  return {
    diagnostic: {
      id: "dx",
      client_id: "c1",
      status: "build",
      tools_in_use: "Outlook, Excel\nQuickBooks",
      it_contact: null,
      access_secured: true,
      brief_sent: true,
      conversations_booked: true,
      scope: "Front office",
      capacity_destination: "Answer every quote request the same day.",
      pledge_text: "Nobody here is being replaced. I want your time back for the work only you can do.",
      pledge_sent_at: null,
      kickoff_at: "2026-10-01",
      midpoint_at: null,
      midpoint_note: null,
      readout_at: "2026-10-22",
      published_at: null,
      guarantee_hours: 3,
      decision: "pending",
      archived_at: null,
      created_at: "2026-09-25T00:00:00Z",
      data_at_risk: "Customer contact details, pricing",
      guardrail_rules: "1. A person reads every draft before it goes out\n2. No customer data in a personal account\n3. Name one owner for each tool",
      roadmap: [{ title: "Order entry from email", target_week: 3, champion: "Estimator" }],
      narrative: null,
      published_readout: null,
      decided_at: null,
      ...overrides,
    },
    client: {
      id: "c1",
      name: "Acme Fabrication",
      owner_name: "Pat Moreau",
      owner_email: null,
      industry: "Manufacturing",
      employee_count: 40,
      city: "Guelph",
      country: "CA",
      source: "referral",
      notes: null,
      archived_at: null,
      created_at: "2026-09-20T00:00:00Z",
    },
    participants: [person("p1", "Dana Ruiz", "Estimator"), person("p2", "Lee Chan", "Estimator"), person("p3", "Sam Ortiz", "Office manager"), person("p4", "Kim Park", null)],
    tasks,
    answers: [],
    notes: [
      note("p1", "Quotes take my mornings.", "Walk the shop floor with new customers", 3),
      note("p2", "", "Follow up on open quotes", 2),
      note("p3", "The inbox never ends.", null, null),
    ],
    quotes: [
      quote("q1", "I spend my mornings retyping the same quote.", "2026-10-06T00:00:00Z"),
      quote("q2", "If the first draft was there, I'd check it and send it.", "2026-10-07T00:00:00Z", "p2"),
      quote("q3", "Unapproved line.", null),
      quote("q4", "The inbox decides my day.", "2026-10-08T00:00:00Z"),
      quote("q5", "A fourth approved line.", "2026-10-09T00:00:00Z"),
    ],
    firstWin:
      firstWin === null
        ? null
        : {
            id: "w1",
            task_id: "t1",
            pattern: "quote_first_draft",
            title: "Quote drafts from email",
            built_at: "2026-10-08",
            in_use_from: "2026-10-12",
            baseline_minutes_per_unit: 25,
            after_minutes_per_unit: 10,
            units_per_week: 24,
            measured_week_ending: "2026-10-16",
            is_first_win: true,
            ...firstWin,
          },
  };
}
