// THE HONOR ROLL on the Dashboard's This week tab: who kept every commitment due last week.
//
// Jason, 2026-11-19. The tile is always called "Honor roll".
//   Owned it      every commitment due last week kept, and each one
//                 marked done by the person themselves. Shown first,
//                 on navy.
//   Clean sweep   every one kept, some marked done by someone else.
//   Nobody kept every one: the three closest instead, the first
//   "Closest to a clean sweep", the others "Almost there".
// Kept means kept on time or kept late: the work landed. Unassigned
// commitments belong to nobody and count for nobody. Names, never
// pronouns ("marked done by Lori").

export type LastWeekRow = {
  owner_id: string;
  owner_name: string;
  status: string;
  resolved_by_profile_id: string | null;
};

export type HonorEntry = {
  id: string;
  name: string;
  ribbon: "Owned it" | "Clean sweep" | "Closest to a clean sweep" | "Almost there";
  why: string;
  // Drawn on navy, the first of the tile.
  lead: boolean;
  // Confetti: only for Owned it.
  celebrate: boolean;
};

export type HonorRoll = {
  mode: "clean" | "closest" | "none";
  people: HonorEntry[];
  // Clean sweeps beyond the ones shown.
  more: number;
};

const SHOW = 6;

const kept = (status: string) => status === "kept_on_time" || status === "kept_late";
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function honorRoll(rows: readonly LastWeekRow[]): HonorRoll {
  const byOwner = new Map<string, { name: string; total: number; kept: number; self: boolean }>();
  for (const r of rows) {
    const p = byOwner.get(r.owner_id) ?? { name: r.owner_name, total: 0, kept: 0, self: true };
    p.total += 1;
    if (kept(r.status)) {
      p.kept += 1;
      if (r.resolved_by_profile_id !== r.owner_id) p.self = false;
    }
    byOwner.set(r.owner_id, p);
  }
  const people = [...byOwner.entries()].map(([id, p]) => ({ id, ...p }));

  const clean = people
    .filter((p) => p.total > 0 && p.kept === p.total)
    .sort((a, b) => Number(b.self) - Number(a.self) || b.total - a.total || a.name.localeCompare(b.name));
  if (clean.length > 0) {
    return {
      mode: "clean",
      people: clean.slice(0, SHOW).map((p) => ({
        id: p.id,
        name: p.name,
        ribbon: p.self ? "Owned it" : "Clean sweep",
        why: p.self
          ? `${p.kept} of ${p.total} kept, every one marked done by ${firstName(p.name)}.`
          : `${p.kept} of ${p.total} kept.`,
        lead: p.self,
        celebrate: p.self,
      })),
      more: Math.max(0, clean.length - SHOW),
    };
  }

  const closest = people
    .filter((p) => p.kept > 0)
    .sort((a, b) => b.kept / b.total - a.kept / a.total || b.kept - a.kept || a.name.localeCompare(b.name))
    .slice(0, 3);
  if (closest.length === 0) return { mode: "none", people: [], more: 0 };
  return {
    mode: "closest",
    people: closest.map((p, i) => ({
      id: p.id,
      name: p.name,
      ribbon: i === 0 ? "Closest to a clean sweep" : "Almost there",
      why:
        i === 0 && p.total - p.kept === 1
          ? `${p.kept} of ${p.total} kept. One away from all of them.`
          : `${p.kept} of ${p.total} kept.`,
      lead: i === 0,
      celebrate: false,
    })),
    more: 0,
  };
}
