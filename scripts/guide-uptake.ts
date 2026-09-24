// Is anybody taking the Guide's invitations up?
//
//   npm run guide:uptake              every active instance
//   npm run guide:uptake -- --weeks 8
//
// Reads public.guide_nudge_weekly (0235) and prints one line per
// company per week. Writes nothing.
//
// ---- THE NUMBER TO WATCH ---------------------------------------
//
// `opened` against `raised`. Everything else is context.
//
// A week with NO ROW raised nothing: the champion seat is empty, or
// no meeting was analysed. That is not the same as a week where
// three invitations went out and nobody came, and the report keeps
// them apart by only ever printing weeks that had nudges in them —
// see the view's comment. A company that has stopped appearing is
// answering a different question from one appearing with zeros.
//
// `superseded` is not a failure on its own. It counts invitations
// replaced by a newer one before anybody opened them, which is what
// should happen when meetings come faster than debriefs. A column
// that is mostly superseded with few opens is the Guide talking to
// itself.

import { readFileSync } from "node:fs";
import { forEachActiveInstance } from "@/lib/instances/for-each";
import { isEntryPoint } from "./lib/entry-point.ts";

for (const f of [".env.provisioning", ".env.local"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

type Row = {
  company_id: string;
  week_starting: string;
  raised: number;
  opened: number;
  dismissed: number;
  superseded: number;
  still_pending: number;
};

export function reportLines(
  rows: readonly Row[],
  names: ReadonlyMap<string, string>
): string[] {
  if (rows.length === 0) {
    // Said in words rather than printed as an empty table. "No rows"
    // and "no nudges have ever been raised" look the same on screen
    // and mean very different things about whether this works.
    return ["  No nudges raised in this window on this instance."];
  }
  const lines = [
    `  ${"week".padEnd(12)}${"company".padEnd(28)}` +
      `${"raised".padStart(7)}${"opened".padStart(8)}` +
      `${"dismissed".padStart(11)}${"superseded".padStart(12)}` +
      `${"pending".padStart(9)}`,
  ];
  for (const r of rows) {
    lines.push(
      `  ${r.week_starting.padEnd(12)}` +
        `${(names.get(r.company_id) ?? r.company_id).slice(0, 26).padEnd(28)}` +
        `${String(r.raised).padStart(7)}${String(r.opened).padStart(8)}` +
        `${String(r.dismissed).padStart(11)}${String(r.superseded).padStart(12)}` +
        `${String(r.still_pending).padStart(9)}`
    );
  }
  const raised = rows.reduce((n, r) => n + Number(r.raised), 0);
  const opened = rows.reduce((n, r) => n + Number(r.opened), 0);
  lines.push(
    `  ${opened} of ${raised} invitations opened` +
      `${raised > 0 ? ` (${Math.round((opened / raised) * 100)}%)` : ""}`
  );
  return lines;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const weeksArg = args.indexOf("--weeks");
  const weeks = weeksArg === -1 ? 6 : Number(args[weeksArg + 1] ?? 6);
  const since = new Date(Date.now() - weeks * 7 * 86400_000)
    .toISOString()
    .slice(0, 10);

  const summary = await forEachActiveInstance<string[]>({
    job: "guide-uptake",
    run: async ({ admin }) => {
      const { data, error } = await admin
        .from("guide_nudge_weekly")
        .select("*")
        .gte("week_starting", since)
        .order("week_starting", { ascending: false });
      // Loud rather than an empty table: a view that is missing on
      // one instance is the fleet being out of step, and an empty
      // report would read as "nothing happened there".
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Row[];
      const ids = [...new Set(rows.map((r) => r.company_id))];
      const { data: companies } = ids.length
        ? await admin.from("companies").select("id, name").in("id", ids)
        : { data: [] as Array<{ id: string; name: string }> };
      const names = new Map(
        ((companies ?? []) as Array<{ id: string; name: string }>).map((c) => [
          c.id,
          c.name,
        ])
      );
      return reportLines(rows, names);
    },
    line: (lines) => `\n${lines.join("\n")}`,
  });

  process.exit(summary.ok ? 0 : 1);
}

if (isEntryPoint(import.meta.url)) {
  void main();
}
