import type { Band, MissionType, OrientationNote } from "./team-scoring";

export const MISSION_LABELS: Record<MissionType, string> = {
  launch: "Launch",
  stabilize: "Stabilize",
  turnaround: "Turnaround",
  growth: "Growth",
  general: "General",
};

export const MISSION_BLURBS: Record<MissionType, string> = {
  launch: "A new product, initiative, or market.",
  stabilize: "Operations, process, reliability.",
  turnaround: "Fixing something that's failing.",
  growth: "Scaling what already works.",
  general: "A standing team without a dominant phase.",
};

export const BAND_LABELS: Record<Band, string> = {
  strong: "Strong fit",
  workable: "Workable fit",
  stretch: "Stretch",
};

export const BAND_HELP: Record<Band, string> = {
  strong:
    "The energy this mission calls for is well covered across the team, with no meaningful gaps.",
  workable:
    "The team can carry this mission, though some parts of the arc rest on fewer people than is ideal.",
  stretch:
    "This roster is missing energy in a dimension the mission leans on heavily. Worth another look.",
};

export const ORIENTATION_NOTE_LABELS: Record<OrientationNote, string> = {
  direct_heavy: "Direct-heavy mix",
  facilitative_heavy: "Facilitative-heavy mix",
  balanced: "Balanced orientation mix",
};

export const ORIENTATION_NOTE_HELP: Record<OrientationNote, string> = {
  direct_heavy:
    "Most of the team leans strongly direct. Watch for collaboration friction on decisions that need broad buy-in.",
  facilitative_heavy:
    "Most of the team leans strongly facilitative. Watch for slower calls on decisions that need someone to just make them.",
  balanced: "The mix of direct and facilitative reads healthy for this size.",
};

export function rosterHash(
  memberIds: string[],
  missionType: MissionType,
): string {
  const sorted = [...memberIds].sort();
  return `${missionType}:${sorted.join("|")}`;
}
