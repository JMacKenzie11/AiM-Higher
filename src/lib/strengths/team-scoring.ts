import {
  DIMENSION_LABELS,
  SUB_STRENGTH_LABELS,
  type Dimension,
  type ResultsProfile,
  type SubStrengthResult,
} from "./types";

export type MissionType =
  | "launch"
  | "stabilize"
  | "turnaround"
  | "growth"
  | "general";

export type Band = "strong" | "workable" | "stretch";
export type OrientationNote =
  | "direct_heavy"
  | "facilitative_heavy"
  | "balanced";

// -----------------------------------------------------------------------------
// Coverage tiers.
//
// Each person's flag on a sub-strength drives their coverage contribution:
//   signature  → competence >= 4 AND energy >= 4  (full-value coverage)
//   emerging   → energy >= 4 AND competence <= 3  (partial-value coverage)
//   draining   → competence >= 4 AND energy <= 2  (never counts as coverage)
//   other      → neither counts nor drains
//
// The flag is already stamped on each SubStrengthResult in individual results.
// -----------------------------------------------------------------------------

export type CoverageTier = "signature" | "emerging";

// -----------------------------------------------------------------------------
// Mission stakes.
//
// Governs how heavily emerging coverage discounts toward the overall fit band,
// and how strongly recommend-mode's greedy selection prefers signature holders.
// -----------------------------------------------------------------------------

export type Stakes = "high" | "medium" | "development-friendly";

export const MISSION_STAKES: Record<MissionType, Stakes> = {
  turnaround: "high",
  stabilize: "high",
  launch: "medium",
  growth: "development-friendly",
  general: "development-friendly",
};

// Multiplier applied to emerging coverage when rolling up the overall band.
// High-stakes missions insist on signature; dev-friendly missions accept
// energy that's still developing.
export const EMERGING_MULTIPLIER: Record<Stakes, number> = {
  high: 0.25,
  medium: 0.375,
  "development-friendly": 0.5,
};

// Mission weight profiles. Weights are relative emphasis, sum to 1.0.
export const MISSION_WEIGHTS: Record<MissionType, Record<Dimension, number>> = {
  launch: { thinking: 0.35, influence: 0.30, execution: 0.20, relating: 0.15 },
  stabilize: { thinking: 0.15, influence: 0.15, execution: 0.45, relating: 0.25 },
  turnaround: { thinking: 0.30, influence: 0.30, execution: 0.25, relating: 0.15 },
  growth: { thinking: 0.20, influence: 0.30, execution: 0.30, relating: 0.20 },
  general: { thinking: 0.25, influence: 0.25, execution: 0.25, relating: 0.25 },
};

const DIMENSIONS: Dimension[] = [
  "thinking",
  "influence",
  "execution",
  "relating",
];

const SUB_STRENGTHS_BY_DIMENSION: Record<Dimension, string[]> = {
  thinking: ["ideation", "problem_solving", "analysis", "foresight", "judgment"],
  influence: ["mobilizing", "communication", "direction", "connecting"],
  execution: ["follow_through", "organizing", "ownership"],
  relating: ["developing_others", "empathy", "building_trust", "including"],
};

export type Member = {
  profile_id: string;
  results: ResultsProfile;
};

export type OverallocationInput = {
  profile_id: string;
  other_active_teams: number;
};

export type DimensionSignal = {
  dimension: Dimension;
  coverage_count: number; // members with signature OR emerging in this dim
  signature_count: number; // members with at least one signature in this dim
  emerging_count: number; // members with emerging but no signature in this dim
  depth: number; // mean of each member's best energy sub-strength in the dim
  gap: boolean; // true when coverage_count === 0
  mission_weight: number;
  tier_strength: number; // 1 (signature), emerging_multiplier (emerging-only), or 0
};

export type SubStrengthSignal = {
  sub_strength: string;
  state:
    | "covered_signature"
    | "covered_emerging"
    | "sole_holder"
    | "uncovered";
  holder: string | null; // set only when state === "sole_holder"
  tier: CoverageTier | null; // signature/emerging for covered_*/sole_holder, null for uncovered
};

export type DrainingWarning = {
  profile_id: string;
  sub_strength: string;
};

export type OverallocatedSignal = {
  profile_id: string;
  other_active_teams: number;
};

export type TeamSignals = {
  band: Band;
  dimensions: DimensionSignal[];
  sub_strengths: SubStrengthSignal[];
  duplications: string[];
  draining_warnings: DrainingWarning[];
  orientation_note: OrientationNote;
  overallocated: OverallocatedSignal[];
};

// -----------------------------------------------------------------------------
// Tier helpers
// -----------------------------------------------------------------------------

function subTierOf(sub: SubStrengthResult): CoverageTier | null {
  if (sub.flag === "signature") return "signature";
  if (sub.flag === "hidden_pull") return "emerging";
  return null; // draining and lower_priority never count as coverage
}

function memberDimTier(m: Member, dim: Dimension): CoverageTier | null {
  let best: CoverageTier | null = null;
  for (const s of m.results.sub_strengths) {
    if (s.dimension !== dim) continue;
    const tier = subTierOf(s);
    if (tier === "signature") return "signature";
    if (tier === "emerging") best = "emerging";
  }
  return best;
}

// -----------------------------------------------------------------------------
// Scoring
// -----------------------------------------------------------------------------

export function scoreTeam(
  roster: Member[],
  missionType: MissionType,
  overallocation: OverallocationInput[] = [],
): TeamSignals {
  const weights = MISSION_WEIGHTS[missionType];
  const stakes = MISSION_STAKES[missionType];
  const emergingMultiplier = EMERGING_MULTIPLIER[stakes];

  // 1. Arc coverage per dimension (tier-aware).
  const dimensions: DimensionSignal[] = DIMENSIONS.map((dim) => {
    let signature_count = 0;
    let emerging_count = 0;
    for (const m of roster) {
      const tier = memberDimTier(m, dim);
      if (tier === "signature") signature_count++;
      else if (tier === "emerging") emerging_count++;
    }
    const coverage_count = signature_count + emerging_count;

    const bestEnergies = roster.map((m) => {
      const dimSubs = m.results.sub_strengths.filter(
        (s) => s.dimension === dim,
      );
      return dimSubs.length === 0
        ? 0
        : Math.max(...dimSubs.map((s) => s.energy));
    });
    const depth =
      bestEnergies.length === 0
        ? 0
        : bestEnergies.reduce((a, b) => a + b, 0) / bestEnergies.length;

    const tier_strength =
      signature_count > 0
        ? 1
        : emerging_count > 0
          ? emergingMultiplier
          : 0;

    return {
      dimension: dim,
      coverage_count,
      signature_count,
      emerging_count,
      depth: Number(depth.toFixed(2)),
      gap: coverage_count === 0,
      mission_weight: weights[dim],
      tier_strength: Number(tier_strength.toFixed(3)),
    };
  });

  // 2. Sub-strength coverage map with tier annotation.
  const sub_strengths: SubStrengthSignal[] = [];
  for (const dim of DIMENSIONS) {
    for (const sub of SUB_STRENGTHS_BY_DIMENSION[dim]) {
      const sigHolders: Member[] = [];
      const emergHolders: Member[] = [];
      for (const m of roster) {
        const rec = m.results.sub_strengths.find(
          (x) => x.sub_strength === sub,
        );
        if (!rec) continue;
        const tier = subTierOf(rec);
        if (tier === "signature") sigHolders.push(m);
        else if (tier === "emerging") emergHolders.push(m);
      }
      const totalHolders = sigHolders.length + emergHolders.length;

      let state: SubStrengthSignal["state"];
      let holder: string | null = null;
      let tier: CoverageTier | null = null;

      if (totalHolders === 0) {
        state = "uncovered";
      } else if (totalHolders === 1) {
        state = "sole_holder";
        if (sigHolders.length === 1) {
          holder = sigHolders[0].profile_id;
          tier = "signature";
        } else {
          holder = emergHolders[0].profile_id;
          tier = "emerging";
        }
      } else if (sigHolders.length > 0) {
        state = "covered_signature";
        tier = "signature";
      } else {
        state = "covered_emerging";
        tier = "emerging";
      }

      sub_strengths.push({ sub_strength: sub, state, holder, tier });
    }
  }

  // 3. Duplications: sub-strengths where 3+ members have any coverage.
  const duplications: string[] = [];
  for (const dim of DIMENSIONS) {
    for (const sub of SUB_STRENGTHS_BY_DIMENSION[dim]) {
      let count = 0;
      for (const m of roster) {
        const rec = m.results.sub_strengths.find(
          (x) => x.sub_strength === sub,
        );
        if (rec && subTierOf(rec) !== null) count++;
      }
      if (count >= 3) duplications.push(sub);
    }
  }

  // 4. Draining warnings. Unchanged: capable-but-draining on a sub-strength
  //    that sits in one of the mission's top-2 weighted dimensions and that
  //    the team otherwise lacks (no other member covers it at any tier).
  const topDimSet = new Set(
    DIMENSIONS.map((d) => ({ dim: d, w: weights[d] }))
      .sort((a, b) => b.w - a.w)
      .slice(0, 2)
      .map((x) => x.dim),
  );
  const draining_warnings: DrainingWarning[] = [];
  for (const m of roster) {
    for (const s of m.results.sub_strengths) {
      if (
        s.competence >= 4 &&
        s.energy <= 2 &&
        topDimSet.has(s.dimension)
      ) {
        const othersCover = roster.some(
          (m2) =>
            m2.profile_id !== m.profile_id &&
            m2.results.sub_strengths.some(
              (s2) =>
                s2.sub_strength === s.sub_strength &&
                subTierOf(s2) !== null,
            ),
        );
        if (!othersCover) {
          draining_warnings.push({
            profile_id: m.profile_id,
            sub_strength: s.sub_strength,
          });
        }
      }
    }
  }

  // 5. Orientation mix (unchanged).
  const total = roster.length;
  let direct = 0;
  let facilitative = 0;
  for (const m of roster) {
    const lean = m.results.orientation.lean;
    if (lean === "direct") direct++;
    else if (lean === "facilitative") facilitative++;
  }
  let orientation_note: OrientationNote = "balanced";
  if (total > 0) {
    if (direct / total >= 0.75) orientation_note = "direct_heavy";
    else if (facilitative / total >= 0.75)
      orientation_note = "facilitative_heavy";
  }

  // 6. Overallocation pass-through.
  const overallocated: OverallocatedSignal[] = overallocation
    .filter(
      (o) =>
        o.other_active_teams > 0 &&
        roster.some((m) => m.profile_id === o.profile_id),
    )
    .map((o) => ({
      profile_id: o.profile_id,
      other_active_teams: o.other_active_teams,
    }));

  // 7. Overall band, driven by tier-weighted coverage rather than raw depth.
  //   weightedTier = Σ weight * tier_strength      (range 0..1)
  //   gapPenalty   = Σ weight where gap            (range 0..1)
  // - gapPenalty >= 0.25 → stretch (a gap in a mission's primary or secondary
  //   weighted dimension is a hard fail).
  // - weightedTier >= 0.85 with no residual gap → strong. This is close to
  //   requiring signature coverage across the arc.
  // - weightedTier >= 0.5 → workable.
  // - Otherwise → stretch.
  const weightedTier = dimensions.reduce(
    (acc, d) => acc + d.mission_weight * d.tier_strength,
    0,
  );
  const gapPenalty = dimensions.reduce(
    (acc, d) => acc + (d.gap ? d.mission_weight : 0),
    0,
  );
  let band: Band;
  if (roster.length === 0) {
    band = "stretch";
  } else if (gapPenalty >= 0.25) {
    band = "stretch";
  } else if (weightedTier >= 0.85 && gapPenalty === 0) {
    band = "strong";
  } else if (weightedTier >= 0.5) {
    band = "workable";
  } else {
    band = "stretch";
  }

  return {
    band,
    dimensions,
    sub_strengths,
    duplications,
    draining_warnings,
    orientation_note,
    overallocated,
  };
}

// -----------------------------------------------------------------------------
// Recommend mode: greedy selection with tier preference.
// -----------------------------------------------------------------------------

export type Candidate = Member & { other_active_teams: number };

export type RecommendedPick = {
  profile_id: string;
  pinned: boolean;
  reason: string;
  brought_in_on: CoverageTier | "pinned";
};

export type RecommendationResult = {
  roster: RecommendedPick[];
  signals: TeamSignals;
};

// Weighted tier gain if we add this candidate. Returns two values: the gain
// from signature contribution and the gain from emerging contribution, kept
// separate so the two-round selection can prefer signature first.
function tierGains(
  candidate: Member,
  currentTeam: Member[],
  missionType: MissionType,
): { signature: number; emerging: number } {
  const weights = MISSION_WEIGHTS[missionType];
  const stakes = MISSION_STAKES[missionType];
  const emergingMultiplier = EMERGING_MULTIPLIER[stakes];

  let sig = 0;
  let emerg = 0;

  for (const dim of DIMENSIONS) {
    // Current tier strength for this dim (before adding the candidate).
    let hasSignature = false;
    let hasEmerging = false;
    for (const m of currentTeam) {
      const t = memberDimTier(m, dim);
      if (t === "signature") hasSignature = true;
      else if (t === "emerging") hasEmerging = true;
    }
    const currentTier = hasSignature
      ? 1
      : hasEmerging
        ? emergingMultiplier
        : 0;

    const candTier = memberDimTier(candidate, dim);
    const w = weights[dim];

    if (candTier === "signature" && currentTier < 1) {
      sig += w * (1 - currentTier);
    } else if (
      candTier === "emerging" &&
      !hasSignature &&
      currentTier < emergingMultiplier
    ) {
      emerg += w * (emergingMultiplier - currentTier);
    }
  }
  return {
    signature: Number(sig.toFixed(4)),
    emerging: Number(emerg.toFixed(4)),
  };
}

function uncoveredReductionOf(
  candidate: Member,
  currentTeam: Member[],
  missionType: MissionType,
): number {
  const before = scoreTeam(currentTeam, missionType).sub_strengths.filter(
    (x) => x.state === "uncovered",
  ).length;
  const after = scoreTeam(
    [...currentTeam, candidate],
    missionType,
  ).sub_strengths.filter((x) => x.state === "uncovered").length;
  return before - after;
}

function drainingIntroducedOf(
  candidate: Member,
  currentTeam: Member[],
  missionType: MissionType,
): number {
  const before = scoreTeam(currentTeam, missionType).draining_warnings.length;
  const after = scoreTeam([...currentTeam, candidate], missionType)
    .draining_warnings.length;
  return Math.max(0, after - before);
}

function candidateSignatureSubStrengthsFilled(
  candidate: Member,
  currentTeam: Member[],
): string[] {
  const beforeSub = new Map(
    scoreTeam(currentTeam, "general").sub_strengths.map((s) => [
      s.sub_strength,
      s,
    ]),
  );
  const filled: string[] = [];
  for (const s of candidate.results.sub_strengths) {
    if (subTierOf(s) !== "signature") continue;
    const before = beforeSub.get(s.sub_strength);
    if (!before) continue;
    if (before.state === "uncovered" || before.tier === "emerging") {
      filled.push(s.sub_strength);
    }
  }
  return filled;
}

function candidateEmergingSubStrengthsFilled(
  candidate: Member,
  currentTeam: Member[],
): string[] {
  const beforeSub = new Map(
    scoreTeam(currentTeam, "general").sub_strengths.map((s) => [
      s.sub_strength,
      s,
    ]),
  );
  const filled: string[] = [];
  for (const s of candidate.results.sub_strengths) {
    if (subTierOf(s) !== "emerging") continue;
    const before = beforeSub.get(s.sub_strength);
    if (!before) continue;
    if (before.state === "uncovered") filled.push(s.sub_strength);
  }
  return filled;
}

function reasonForPick(
  candidate: Member,
  currentTeamBefore: Member[],
  tier: CoverageTier,
): string {
  const topEnergy = [...candidate.results.sub_strengths]
    .sort((a, b) => b.energy - a.energy)
    .slice(0, 2)
    .map((s) => SUB_STRENGTH_LABELS[s.sub_strength] ?? s.sub_strength);

  if (tier === "signature") {
    const filled = candidateSignatureSubStrengthsFilled(
      candidate,
      currentTeamBefore,
    )
      .slice(0, 2)
      .map((s) => SUB_STRENGTH_LABELS[s] ?? s);
    if (filled.length > 0) {
      return `Brought in on signature: ${filled.join(" and ")}.`;
    }
    return `Signature strength on ${topEnergy.join(" and ")}.`;
  } else {
    const filled = candidateEmergingSubStrengthsFilled(
      candidate,
      currentTeamBefore,
    )
      .slice(0, 2)
      .map((s) => SUB_STRENGTH_LABELS[s] ?? s);
    if (filled.length > 0) {
      return `Brought in on emerging energy: ${filled.join(" and ")}.`;
    }
    return `Emerging energy on ${topEnergy.join(" and ")}.`;
  }
}

export function recommendTeam(
  candidates: Candidate[],
  missionType: MissionType,
  targetSize: number,
  pinnedIds: string[],
): RecommendationResult {
  const byId = new Map(candidates.map((c) => [c.profile_id, c]));
  const stakes = MISSION_STAKES[missionType];
  const isDevFriendly = stakes === "development-friendly";

  const picked: RecommendedPick[] = [];
  const currentMembers: Member[] = [];

  // Start with pinned members.
  for (const id of pinnedIds) {
    const c = byId.get(id);
    if (!c) continue;
    picked.push({
      profile_id: id,
      pinned: true,
      reason: "Pinned by you.",
      brought_in_on: "pinned",
    });
    currentMembers.push({ profile_id: id, results: c.results });
  }
  const pickedIds = new Set(picked.map((p) => p.profile_id));

  while (picked.length < targetSize) {
    const remaining = candidates.filter((c) => !pickedIds.has(c.profile_id));
    if (remaining.length === 0) break;

    type Scored = {
      candidate: Candidate;
      sigGain: number;
      emergGain: number;
      uncoveredReduction: number;
      overallocation: number;
      drainingIntroduced: number;
    };
    const scored: Scored[] = remaining.map((cand) => {
      const gains = tierGains(cand, currentMembers, missionType);
      return {
        candidate: cand,
        sigGain: gains.signature,
        emergGain: gains.emerging,
        uncoveredReduction: uncoveredReductionOf(
          cand,
          currentMembers,
          missionType,
        ),
        overallocation: cand.other_active_teams,
        drainingIntroduced: drainingIntroducedOf(
          cand,
          currentMembers,
          missionType,
        ),
      };
    });

    // Round 1: signature-contributing candidates.
    const withSig = scored.filter((s) => s.sigGain > 1e-9);

    let pool = withSig;
    let usedTier: CoverageTier = "signature";

    if (withSig.length === 0) {
      // Round 2: emerging.
      const withEmerg = scored.filter((s) => s.emergGain > 1e-9);
      if (withEmerg.length === 0) {
        // No coverage gain from anyone remaining — fall back to any candidate,
        // preferring lower overallocation. This is rare (roster already covers
        // everything the mission can lean on).
        pool = scored;
        usedTier = "emerging"; // best-effort label
      } else {
        pool = withEmerg;
        usedTier = "emerging";
      }
    } else if (isDevFriendly) {
      // Dev-friendly relief valve: if every signature candidate is already
      // overallocated AND there is an emerging candidate with zero
      // overallocation whose emerging strengths improve coverage, add the
      // fresh emerging candidates to the pool as alternatives.
      const allSigOverallocated = withSig.every(
        (s) => s.overallocation > 0,
      );
      if (allSigOverallocated) {
        const freshEmerging = scored.filter(
          (s) =>
            s.sigGain === 0 &&
            s.emergGain > 1e-9 &&
            s.overallocation === 0,
        );
        if (freshEmerging.length > 0) {
          pool = [...withSig, ...freshEmerging];
        }
      }
    }

    // Pick the best candidate in the pool. Comparison order:
    //   1. Signature contribution (higher wins) — establishes tier preference
    //   2. Emerging contribution (higher wins)
    //   3. Uncovered sub-strength reduction (higher wins)
    //   4. Overallocation (lower wins)
    //   5. Draining introduced (lower wins)
    const best = pool.reduce<Scored | null>((acc, s) => {
      if (acc === null) return s;
      const cmpSig = s.sigGain - acc.sigGain;
      if (cmpSig > 1e-9) return s;
      if (cmpSig < -1e-9) return acc;
      const cmpEmerg = s.emergGain - acc.emergGain;
      if (cmpEmerg > 1e-9) return s;
      if (cmpEmerg < -1e-9) return acc;
      if (s.uncoveredReduction > acc.uncoveredReduction) return s;
      if (s.uncoveredReduction < acc.uncoveredReduction) return acc;
      if (s.overallocation < acc.overallocation) return s;
      if (s.overallocation > acc.overallocation) return acc;
      if (s.drainingIntroduced < acc.drainingIntroduced) return s;
      return acc;
    }, null);
    if (!best) break;

    // Confirm the tier we actually used for reason-labelling: signature
    // if the pick provided any signature gain, else emerging.
    const actualTier: CoverageTier =
      best.sigGain > 1e-9 ? "signature" : usedTier;

    const reason = reasonForPick(best.candidate, currentMembers, actualTier);

    picked.push({
      profile_id: best.candidate.profile_id,
      pinned: false,
      reason,
      brought_in_on: actualTier,
    });
    currentMembers.push({
      profile_id: best.candidate.profile_id,
      results: best.candidate.results,
    });
    pickedIds.add(best.candidate.profile_id);
  }

  const signals = scoreTeam(
    currentMembers,
    missionType,
    picked.map((p) => ({
      profile_id: p.profile_id,
      other_active_teams:
        byId.get(p.profile_id)?.other_active_teams ?? 0,
    })),
  );

  return { roster: picked, signals };
}

// Small re-export used by the reason-generation logic.
export { DIMENSION_LABELS };
