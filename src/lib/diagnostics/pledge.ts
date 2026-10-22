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
