import type {
  Dimension,
  DimensionResult,
  Flag,
  Item,
  Response,
  SubStrengthResult,
} from "./types";

export function flagFor(competence: number, energy: number): Flag {
  if (competence >= 4 && energy >= 4) return "signature";
  if (competence >= 4 && energy <= 2) return "capable_but_draining";
  if (energy >= 4 && competence <= 3) return "hidden_pull";
  if (competence <= 2 && energy <= 2) return "lower_priority";
  // Fall back to lower_priority framing when the pair sits in neutral territory
  // — a neutral score isn't a weakness, it's simply not a signature strength.
  return "lower_priority";
}

export interface ScoringOutput {
  dimensions: DimensionResult[];
  sub_strengths: Omit<SubStrengthResult, "narrative_evidence">[];
  orientation: {
    lean: "direct" | "balanced" | "facilitative";
    score: number;
    by_dimension: Record<string, number>;
  };
}

/**
 * Purely deterministic scoring. Turns raw responses into the numeric shape the
 * Claude prompt then reasons about (flags, evidence, summary). Averages are
 * kept separate for competence and energy per spec, never collapsed.
 */
export function scoreResponses(items: Item[], responses: Response[]): ScoringOutput {
  const byId = new Map(items.map((i) => [i.id, i]));
  const answers = new Map(responses.map((r) => [r.item_id, r.value]));

  // Group Likert items by sub_strength
  const bySubStrength = new Map<
    string,
    { dimension: Dimension; competence?: number; energy?: number }
  >();

  for (const item of items) {
    if (item.item_type === "orientation") continue;
    const value = answers.get(item.id);
    if (value === undefined) continue;
    const entry = bySubStrength.get(item.sub_strength) ?? {
      dimension: item.dimension,
    };
    if (item.item_type === "competence") entry.competence = value;
    if (item.item_type === "energy") entry.energy = value;
    entry.dimension = item.dimension;
    bySubStrength.set(item.sub_strength, entry);
  }

  const sub_strengths: Omit<SubStrengthResult, "narrative_evidence">[] = [];
  for (const [sub_strength, entry] of bySubStrength) {
    if (entry.competence === undefined || entry.energy === undefined) continue;
    sub_strengths.push({
      sub_strength,
      dimension: entry.dimension,
      competence: entry.competence,
      energy: entry.energy,
      flag: flagFor(entry.competence, entry.energy),
    });
  }

  // Dimension averages
  const dims: Dimension[] = ["thinking", "influence", "execution", "relating"];
  const dimensions: DimensionResult[] = dims.map((d) => {
    const rows = sub_strengths.filter((s) => s.dimension === d);
    const cAvg = rows.length
      ? rows.reduce((a, r) => a + r.competence, 0) / rows.length
      : 0;
    const eAvg = rows.length
      ? rows.reduce((a, r) => a + r.energy, 0) / rows.length
      : 0;
    return {
      dimension: d,
      competence_avg: round2(cAvg),
      energy_avg: round2(eAvg),
    };
  });

  // Orientation: normalized 1..4 already stored (1 = strongly direct, 4 = strongly facilitative)
  const orientationItems = items.filter((i) => i.item_type === "orientation");
  const orientationValues: number[] = [];
  const byDim: Record<string, number[]> = {};
  for (const it of orientationItems) {
    const v = answers.get(it.id);
    if (v === undefined) continue;
    orientationValues.push(v);
    (byDim[it.dimension] ??= []).push(v);
  }
  const overall = orientationValues.length
    ? orientationValues.reduce((a, b) => a + b, 0) / orientationValues.length
    : 0;
  let lean: "direct" | "balanced" | "facilitative" = "balanced";
  if (overall >= 1 && overall <= 2) lean = "direct";
  else if (overall > 2 && overall < 3) lean = "balanced";
  else if (overall >= 3 && overall <= 4) lean = "facilitative";

  const by_dimension: Record<string, number> = {};
  for (const [d, vs] of Object.entries(byDim)) {
    by_dimension[d] = round2(vs.reduce((a, b) => a + b, 0) / vs.length);
  }

  return {
    dimensions,
    sub_strengths,
    orientation: {
      lean,
      score: round2(overall),
      by_dimension,
    },
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
