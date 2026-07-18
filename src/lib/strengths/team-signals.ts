import type { ResultsProfile } from "./types";

export type CoverageLevel = "none" | "sole_holder" | "thin" | "solid";

export type TeamMember = {
  id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  reports_to: string | null;
  profile: ResultsProfile;
};

export type SubStrengthCoverage = {
  sub_strength: string;
  count: number;
  level: CoverageLevel;
  holder_ids: string[];
};

export type PersonRef = {
  id: string;
  first_name: string;
  last_name: string;
  position: string | null;
};

export type SoleHolder = {
  sub_strength: string;
  person: PersonRef;
};

export type EnergyGap = {
  sub_strength: string;
  competence: number;
  energy: number;
  gap: number;
  person: PersonRef;
};

export type OrientationMix = {
  direct: number;
  balanced: number;
  facilitative: number;
  total: number;
};

export type TeamSignals = {
  coverage: SubStrengthCoverage[];
  sole_holders: SoleHolder[];
  energy_gaps: EnergyGap[];
  orientation_mix: OrientationMix;
  roster_size: number;
};

const toRef = (m: TeamMember): PersonRef => ({
  id: m.id,
  first_name: m.first_name,
  last_name: m.last_name,
  position: m.position,
});

export function computeTeamSignals(team: TeamMember[]): TeamSignals {
  const size = team.length;

  const holdersBySub = new Map<string, TeamMember[]>();
  const allSubs = new Set<string>();
  for (const m of team) {
    for (const s of m.profile.sub_strengths) {
      allSubs.add(s.sub_strength);
      if (s.energy >= 4) {
        const arr = holdersBySub.get(s.sub_strength) ?? [];
        arr.push(m);
        holdersBySub.set(s.sub_strength, arr);
      }
    }
  }

  const coverage: SubStrengthCoverage[] = Array.from(allSubs).map((sub) => {
    const holders = holdersBySub.get(sub) ?? [];
    const count = holders.length;
    const level: CoverageLevel =
      count === 0
        ? "none"
        : count === 1
          ? "sole_holder"
          : size > 0 && count / size < 0.34
            ? "thin"
            : "solid";
    return {
      sub_strength: sub,
      count,
      level,
      holder_ids: holders.map((h) => h.id),
    };
  });

  const sole_holders: SoleHolder[] = coverage
    .filter((c) => c.level === "sole_holder")
    .map((c) => {
      const holder = (holdersBySub.get(c.sub_strength) ?? [])[0];
      return { sub_strength: c.sub_strength, person: toRef(holder) };
    });

  const gaps: EnergyGap[] = [];
  for (const m of team) {
    for (const s of m.profile.sub_strengths) {
      if (s.competence >= 4 && s.energy <= 2) {
        gaps.push({
          sub_strength: s.sub_strength,
          competence: s.competence,
          energy: s.energy,
          gap: s.competence - s.energy,
          person: toRef(m),
        });
      }
    }
  }
  gaps.sort((a, b) => b.gap - a.gap);
  const energy_gaps = gaps.slice(0, 5);

  let direct = 0;
  let balanced = 0;
  let facilitative = 0;
  for (const m of team) {
    const lean = m.profile.orientation.lean;
    if (lean === "direct") direct++;
    else if (lean === "balanced") balanced++;
    else if (lean === "facilitative") facilitative++;
  }

  return {
    coverage,
    sole_holders,
    energy_gaps,
    orientation_mix: { direct, balanced, facilitative, total: size },
    roster_size: size,
  };
}
