// The capacity pledge's starting draft, in the owner's voice. The lead
// edits it, the owner sends it. A template rather than a model call in
// phase 1; the drafted-from-kickoff call is phase 3 (diagnostic_pledge).
export function draftPledge(args: { ownerName: string | null; leadName: string; destination: string | null }): string {
  const first = args.ownerName?.trim().split(/\s+/)[0] ?? "";
  const lines = [
    "Hi everyone,",
    "",
    "Over the next three weeks we're looking at the work that gets in the way of your best work, so we can give you time back for the work that matters.",
    "",
    "Nobody loses their job because of this. That's my promise for the next 12 months.",
  ];
  if (args.destination?.trim()) {
    lines.push("", `The time we get back goes first to ${args.destination.trim().replace(/\.$/, "")}.`);
  }
  lines.push(
    "",
    `It will take about 45 minutes of your time: a 15-minute survey and a 30-minute conversation with ${args.leadName}. What you tell them stays with them. I'll see combined results, never your individual answers.`,
    "",
    "Thank you.",
    first
  );
  return lines.join("\n").trimEnd();
}

// ---- The drafted pledge (phase 3, diagnostic_pledge) ----------------
//
// The call writes the same message in the owner's own voice from the
// kickoff answers. Whatever it writes must still make the template's
// promises: the job promise for 12 months, the 45 minutes it asks of
// each person, and that individual answers stay with the lead. Those
// are checked here, with the length and any number the kickoff did not
// supply, so a draft that drops a promise or invents a figure never
// reaches the box.

export const PLEDGE_MAX_WORDS = 120;

export type PledgeFacts = {
  ownerName: string | null;
  leadName: string;
  company: string;
  industry: string | null;
  scope: string | null;
  destination: string | null;
};

const ALLOWED_NUMBERS = ["3", "12", "45", "15", "30"];

export function pledgeWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function checkPledgeDraft(raw: string, facts: PledgeFacts): { text: string; problems: string[] } {
  let text = raw
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/^["“”\s]+|["“”\s]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const first = facts.ownerName?.trim().split(/\s+/)[0] ?? "";
  // The owner signs it.
  if (first && !new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`).test(text)) text = `${text}\n\n${first}`;

  const problems: string[] = [];
  if (pledgeWords(text) > PLEDGE_MAX_WORDS) problems.push(`it is longer than ${PLEDGE_MAX_WORDS} words`);
  if (!/\bjobs?\b/i.test(text) || !/\b(12|twelve) months\b/i.test(text)) problems.push("it leaves out the promise that nobody loses their job for 12 months");
  if (!/\b(45|forty-five) minutes\b/i.test(text)) problems.push("it leaves out the 45 minutes it asks of each person");
  const lead = facts.leadName.trim().split(/\s+/)[0] ?? "";
  const keeper = new RegExp(`stays? (?:only )?with (?:them|${lead.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i");
  if (!/\bindividual\b/i.test(text) || !keeper.test(text)) problems.push(`it leaves out that what each person says stays with ${lead || "the person running it"}, and the owner sees no individual answers`);
  // Nobody's pronouns are guessed from a name.
  if (/\b(he|him|his|she|her|hers)\b/i.test(text)) problems.push("it calls someone he or she; use their name or they");
  const supplied = new Set([...ALLOWED_NUMBERS, ...[facts.scope, facts.destination, facts.company].flatMap((s) => s?.match(/\d+(?:\.\d+)?/g) ?? [])]);
  const foreign = (text.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !supplied.has(n));
  if (foreign.length) problems.push(`it states ${foreign.join(", ")}, which the kickoff did not give`);
  return { text, problems };
}
