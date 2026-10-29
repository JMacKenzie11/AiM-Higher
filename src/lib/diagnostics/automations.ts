import type { AutomationRow, AutomationStage, RoadmapItem, WinRow } from "./types";

// A client's automations (0306): the order they are listed in, and the
// rows a diagnostic's first win and 90-day roadmap start them with.

// Live first, then the ones on their way to it, then planned, then
// paused; within a stage, the soonest go-live first and undated last.
const ORDER: Record<AutomationStage, number> = { live: 0, testing: 1, building: 2, planned: 3, paused: 4 };

export function sortAutomations<T extends Pick<AutomationRow, "stage" | "goes_live" | "created_at">>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      ORDER[a.stage] - ORDER[b.stage] ||
      (a.goes_live ?? "9999").localeCompare(b.goes_live ?? "9999") ||
      a.created_at.localeCompare(b.created_at)
  );
}

export type NewAutomation = {
  title: string;
  stage: AutomationStage;
  goes_live: string | null;
  champion: string | null;
};

const key = (t: string) => t.trim().toLowerCase();

// The first win (live once it is in use, otherwise being built) and
// each next win on the roadmap (planned, with its champion). A title
// the client already has is skipped, so pressing it twice adds nothing
// the second time.
export function automationsFromDiagnostic(firstWin: Pick<WinRow, "title" | "in_use_from"> | null, roadmap: RoadmapItem[], existingTitles: string[]): NewAutomation[] {
  const seen = new Set(existingTitles.map(key));
  const out: NewAutomation[] = [];
  const add = (a: NewAutomation) => {
    if (!a.title.trim() || seen.has(key(a.title))) return;
    seen.add(key(a.title));
    out.push(a);
  };
  if (firstWin) {
    add({ title: firstWin.title, stage: firstWin.in_use_from ? "live" : "building", goes_live: firstWin.in_use_from, champion: null });
  }
  for (const item of roadmap) add({ title: item.title, stage: "planned", goes_live: null, champion: item.champion.trim() || null });
  return out;
}
