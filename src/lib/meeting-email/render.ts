// The weekly meeting email (2026-11-17): what it says, built from
// plain data so it can be tested without a database or a mail
// service. send.ts loads the data and sends one per person.
//
// Prototype: the "Weekly Meeting Summary Email" artifact. Layout is
// tables and inline styles because that is what mail clients render.

import { commitmentLinkPath } from "@/lib/commitments/link";

export const WEEKLY_MEETING_SUBJECT = "Your Weekly Meeting Summary";

// How far ahead the email looks, counted from the day it is sent.
export const WINDOW_DAYS = 7;

export type EmailCommitment = {
  id: string;
  company_id: string;
  issue_id: string | null;
  owner_id: string | null;
  description: string;
  due_date: string; // YYYY-MM-DD
  source_meeting_id: string | null;
};

export type EmailPerson = { id: string; full_name: string };

export type PersonGroup = {
  ownerId: string | null;
  name: string;
  items: Array<EmailCommitment & { late: boolean; isNew: boolean }>;
};

export type Reader = {
  id: string;
  firstName: string | null;
  // The company's assigned AiMS Coach: not on the team, so no "(you)"
  // group and a footer that says why they get it.
  isCoach: boolean;
};

export type WeeklyEmailInput = {
  origin: string; // https://acme.aims-hq.com, no trailing slash
  companyName: string;
  meetingId: string;
  meetingDateIso: string; // the meeting's day, in the company's timezone
  todayIso: string; // the sending day, in the company's timezone
  groups: PersonGroup[];
};

// Late ones first in each person's list, then by due date; people by
// name, with nobody's (unassigned) last. The reader's own group is
// moved to the top per email, in orderForReader.
export function groupCommitments(
  commitments: EmailCommitment[],
  people: EmailPerson[],
  meetingId: string,
  todayIso: string
): PersonGroup[] {
  const names = new Map(people.map((p) => [p.id, p.full_name]));
  const byOwner = new Map<string | null, PersonGroup>();
  for (const c of commitments) {
    const key = c.owner_id && names.has(c.owner_id) ? c.owner_id : null;
    let g = byOwner.get(key);
    if (!g) {
      g = { ownerId: key, name: key ? names.get(key)! : "Not assigned yet", items: [] };
      byOwner.set(key, g);
    }
    g.items.push({
      ...c,
      late: c.due_date < todayIso,
      isNew: c.source_meeting_id === meetingId,
    });
  }
  for (const g of byOwner.values()) {
    g.items.sort((a, b) =>
      a.late !== b.late
        ? a.late ? -1 : 1
        : a.due_date.localeCompare(b.due_date) || a.description.localeCompare(b.description)
    );
  }
  return [...byOwner.values()].sort((a, b) =>
    a.ownerId === null ? 1 : b.ownerId === null ? -1 : a.name.localeCompare(b.name)
  );
}

export function orderForReader(groups: PersonGroup[], readerId: string): PersonGroup[] {
  const mine = groups.find((g) => g.ownerId === readerId);
  return mine ? [mine, ...groups.filter((g) => g !== mine)] : groups;
}

// "Tuesday 17 November", read as a calendar day (no timezone shift).
export function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const day = d.getUTCDate();
  const month = d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  return `${weekday} ${day} ${month}`;
}

export function previewText(groups: PersonGroup[]): string {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const fresh = groups.reduce((n, g) => n + g.items.filter((i) => i.isNew).length, 0);
  if (total === 0) return "Nothing is due across the team in the next week.";
  const due = `${total} ${total === 1 ? "commitment is" : "commitments are"} due across the team in the next week.`;
  if (fresh === 0) return due;
  return `${due} ${fresh} ${fresh === 1 ? "was" : "were"} agreed in this meeting.`;
}

const NAVY = "#1F3352";
const BODY = "#465470";
const MUTED = "#5B6472";
const LINE = "#E2E4DE";
const LIME = "#D6E264";
const SKY = "#8CC4DF";
const COBALT = "#3551A4";
const DANGER = "#A94441";
const SAND = "#F7F7F2";

const PILL =
  `display:inline-block; background:${LIME}; color:${NAVY}; font-size:11px; font-weight:700; ` +
  `letter-spacing:0.04em; text-transform:uppercase; padding:3px 9px; border-radius:999px;`;

export function renderWeeklyMeetingEmail(input: WeeklyEmailInput, reader: Reader): string {
  const groups = reader.isCoach ? input.groups : orderForReader(input.groups, reader.id);
  const until = longDate(addDaysIso(input.todayIso, WINDOW_DAYS));
  const hi = reader.firstName ? `Hi ${escape(reader.firstName)}.` : "Hi.";
  const anyNew = groups.some((g) => g.items.some((i) => i.isNew));
  const summaryUrl = `${input.origin}/leadership/meetings/${input.meetingId}`;
  const company = escape(input.companyName);

  const intro =
    groups.length === 0
      ? `${hi} Nothing is due across the team in the next week, up to <strong style="color:${NAVY};">${until}</strong>.`
      : `${hi} Here are the team&rsquo;s commitments due in the next week, up to <strong style="color:${NAVY};">${until}</strong>. Click any one to open it.`;

  const key = anyNew
    ? `<tr><td class="pad" style="padding:14px 36px 6px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="${PILL}">New</td>
          <td style="padding-left:8px; font-size:13px; color:${MUTED};">agreed in this meeting</td>
        </tr></table>
      </td></tr>`
    : "";

  const sections = groups
    .map((g, gi) => {
      const you = !reader.isCoach && g.ownerId === reader.id;
      const rows = g.items
        .map((c, i) => {
          const last = i === g.items.length - 1;
          const href = `${input.origin}${commitmentLinkPath(c)}`;
          const due = c.late
            ? `<div style="padding-top:4px; font-size:13px; color:${DANGER}; font-weight:600;">Was due ${longDate(c.due_date)}</div>`
            : `<div style="padding-top:4px; font-size:13px; color:${MUTED};">Due ${longDate(c.due_date)}</div>`;
          const pill = c.isNew ? `<span style="${PILL}">New</span>` : "&nbsp;";
          return `<tr><td${last ? "" : ` style="border-bottom:1px solid ${LINE};"`}>
          <a href="${escape(href)}" style="display:block; padding:13px 0; color:${NAVY}; text-decoration:none;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:top;">
                <div style="font-size:15px; line-height:1.45; color:${NAVY};">${escape(c.description)}</div>
                ${due}
              </td>
              <td width="64" align="right" style="vertical-align:top; padding-top:2px; white-space:nowrap;">${pill}</td>
              <td width="22" align="right" style="vertical-align:top; padding-top:1px; font-size:18px; color:${SKY};">&rsaquo;</td>
            </tr></table>
          </a>
        </td></tr>`;
        })
        .join("\n");
      return `<tr><td class="pad" style="padding:${gi === 0 ? 22 : 26}px 36px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2px solid ${NAVY};"><tr>
          <td style="padding:0 0 8px; font-size:16px; font-weight:700; color:${NAVY};">${escape(g.name)}${you ? ` <span style="font-weight:500; color:${MUTED};">(you)</span>` : ""}</td>
          <td align="right" style="padding:0 0 8px; font-size:13px; color:${MUTED};">${g.items.length} due</td>
        </tr></table>
      </td></tr>
      <tr><td class="pad" style="padding:0 36px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${rows}
        </table>
      </td></tr>`;
    })
    .join("\n");

  const footer = reader.isCoach
    ? `You&rsquo;re getting this because you&rsquo;re the AiMS Coach for ${company}.`
    : `You&rsquo;re getting this because you&rsquo;re on the ${company} team in AiMS-HQ.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${WEEKLY_MEETING_SUBJECT}</title>
<style>
  @media (max-width: 620px) {
    .shell { width:100% !important; }
    .pad { padding-left:20px !important; padding-right:20px !important; }
    .h1 { font-size:24px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background:${SAND}; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:${NAVY};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escape(previewText(groups))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" class="shell" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px; background:#FFFFFF; border-radius:14px; overflow:hidden; border:1px solid ${LINE};">
    <tr><td class="pad" style="background:${NAVY}; padding:26px 36px 24px;">
      <img src="${escape(input.origin)}/brand/aims-hq-logo-white.png" width="168" alt="AiMS-HQ" style="display:block; width:168px; height:auto; border:0;">
    </td></tr>
    <tr><td style="height:4px; background:${LIME}; font-size:0; line-height:0;">&nbsp;</td></tr>
    <tr><td class="pad" style="padding:30px 36px 6px;">
      <div style="font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:${MUTED}; font-weight:600;">${company} &middot; ${longDate(input.meetingDateIso)}</div>
      <h1 class="h1" style="margin:10px 0 0; font-size:28px; line-height:1.2; color:${NAVY}; font-weight:700; letter-spacing:-0.01em;">${WEEKLY_MEETING_SUBJECT}</h1>
    </td></tr>
    <tr><td class="pad" style="padding:12px 36px 4px; font-size:15px; line-height:1.6; color:${BODY};">${intro}</td></tr>
    ${key}
    ${sections}
    <tr><td class="pad" style="padding:34px 36px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E8F3F9; border-radius:12px;"><tr>
        <td style="padding:22px 24px;">
          <div style="font-size:16px; font-weight:700; color:${NAVY};">See the whole meeting</div>
          <div style="padding-top:6px; font-size:14px; line-height:1.55; color:${BODY};">The summary, what went well, the issues you worked on, and everything that was agreed.</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr>
            <td style="background:${COBALT}; border-radius:8px;">
              <a href="${escape(summaryUrl)}" style="display:inline-block; padding:12px 22px; font-size:15px; font-weight:600; color:#FFFFFF; text-decoration:none;">Read the meeting summary</a>
            </td>
          </tr></table>
        </td>
      </tr></table>
    </td></tr>
    <tr><td class="pad" style="padding:26px 36px 30px; font-size:12px; line-height:1.6; color:#76839A;">
      ${footer} It comes after each weekly meeting once the summary is ready.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
