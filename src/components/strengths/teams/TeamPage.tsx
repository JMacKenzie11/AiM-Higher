"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SUB_STRENGTH_LABELS,
  DIMENSION_LABELS,
  type Dimension,
  type ResultsProfile,
} from "@/lib/strengths/types";
import {
  scoreTeam,
  MISSION_WEIGHTS,
  type Member,
  type MissionType,
  type TeamSignals,
} from "@/lib/strengths/team-scoring";
import {
  MISSION_LABELS,
  MISSION_BLURBS,
  BAND_LABELS,
  BAND_HELP,
  ORIENTATION_NOTE_LABELS,
  ORIENTATION_NOTE_HELP,
  rosterHash,
} from "@/lib/strengths/team-labels";

export type EligiblePerson = {
  id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  assessment_status: "not_started" | "in_progress" | "completed";
  profile: ResultsProfile | null;
};

type RosterEntry = { profile_id: string; pinned: boolean };

type InitialEvaluation = {
  roster_hash: string;
  narrative: string | null;
} | null;

const MISSION_ORDER: MissionType[] = [
  "launch",
  "stabilize",
  "turnaround",
  "growth",
  "general",
];

const DIM_ORDER: Dimension[] = ["thinking", "influence", "execution", "relating"];

export default function TeamPage({
  teamId,
  name,
  missionType: initialMission,
  missionNotes: initialNotes,
  status: initialStatus,
  roster: initialRoster,
  eligible,
  otherActiveTeams,
  initialEvaluation,
}: {
  teamId: string;
  name: string;
  missionType: MissionType;
  missionNotes: string | null;
  status: "draft" | "active" | "archived";
  roster: RosterEntry[];
  eligible: EligiblePerson[];
  otherActiveTeams: Record<string, number>;
  initialEvaluation: InitialEvaluation;
}) {
  const router = useRouter();
  const [roster, setRoster] = useState<RosterEntry[]>(initialRoster);
  const [missionType, setMissionType] = useState<MissionType>(initialMission);
  const [status, setStatus] = useState(initialStatus);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState("");

  const [narrative, setNarrative] = useState<string | null>(
    initialEvaluation?.narrative ?? null,
  );
  const [narrativeHash, setNarrativeHash] = useState<string | null>(
    initialEvaluation?.roster_hash ?? null,
  );
  const [narrativeState, setNarrativeState] = useState<
    "idle" | "pending" | "generating" | "error"
  >("idle");
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  const eligibleById = useMemo(
    () => new Map(eligible.map((p) => [p.id, p])),
    [eligible],
  );

  // Live signals — recomputed on every roster or mission change.
  const signals = useMemo<TeamSignals | null>(() => {
    const members: Member[] = roster
      .map((r) => {
        const p = eligibleById.get(r.profile_id);
        if (!p || !p.profile) return null;
        return { profile_id: r.profile_id, results: p.profile };
      })
      .filter((m): m is Member => m !== null);

    if (members.length === 0) return null;

    const overallocation = members.map((m) => ({
      profile_id: m.profile_id,
      other_active_teams: otherActiveTeams[m.profile_id] ?? 0,
    }));

    return scoreTeam(members, missionType, overallocation);
  }, [roster, missionType, eligibleById, otherActiveTeams]);

  // The hash of the current roster + mission. When this changes, the cached
  // narrative goes stale and we queue a debounced regeneration.
  const currentHash = useMemo(
    () =>
      rosterHash(
        roster.map((r) => r.profile_id),
        missionType,
      ),
    [roster, missionType],
  );

  // Debounced narrative regeneration. On any signal change, wait 2s of silence
  // before firing the evaluation endpoint. Cancels on further edits.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (roster.length === 0) return;
    if (narrativeHash === currentHash) {
      setNarrativeState("idle");
      return;
    }
    setNarrativeState("pending");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchNarrative();
    }, 2000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHash, roster.length]);

  async function fetchNarrative(force = false) {
    setNarrativeState("generating");
    setNarrativeError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}/evaluation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNarrativeError(data.error ?? "Couldn't build the narrative.");
        setNarrativeState("error");
        return;
      }
      const data = (await res.json()) as {
        narrative: string;
        roster_hash: string;
      };
      setNarrative(data.narrative);
      setNarrativeHash(data.roster_hash);
      setNarrativeState("idle");
    } catch {
      setNarrativeError("Couldn't reach the server.");
      setNarrativeState("error");
    }
  }

  // ---------- Roster mutations ----------

  async function addMember(profile_id: string) {
    setRoster((r) =>
      r.some((x) => x.profile_id === profile_id)
        ? r
        : [...r, { profile_id, pinned: false }],
    );
    setShowPicker(false);
    setSearch("");
    const res = await fetch(`/api/teams/${teamId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile_id }),
    });
    if (!res.ok) {
      // Roll back on failure
      setRoster((r) => r.filter((x) => x.profile_id !== profile_id));
    }
  }

  async function removeMember(profile_id: string) {
    const prev = roster;
    setRoster((r) => r.filter((x) => x.profile_id !== profile_id));
    const res = await fetch(`/api/teams/${teamId}/members`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile_id }),
    });
    if (!res.ok) setRoster(prev);
  }

  async function updateMission(next: MissionType) {
    setMissionType(next);
    await fetch(`/api/teams/${teamId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mission_type: next }),
    });
  }

  async function updateStatus(next: "draft" | "active" | "archived") {
    setStatus(next);
    await fetch(`/api/teams/${teamId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    router.refresh();
  }

  async function saveNotes() {
    await fetch(`/api/teams/${teamId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mission_notes: notes }),
    });
  }

  const rosterIds = new Set(roster.map((r) => r.profile_id));
  const filteredEligible = eligible
    .filter((p) => !rosterIds.has(p.id))
    .filter((p) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
        (p.position ?? "").toLowerCase().includes(q)
      );
    });

  return (
    <div className="stack-5">
      <section className="card stack-3">
        <div className="card-header">
          <h2>Mission</h2>
          <span className="caption">
            <span
              className={`chip ${
                status === "active"
                  ? "chip-primary"
                  : status === "draft"
                    ? "chip-sky"
                    : "chip-muted"
              }`}
            >
              {status[0].toUpperCase() + status.slice(1)}
            </span>
          </span>
        </div>
        <div className="form-grid form-grid-2">
          <label className="stack-1">
            <span className="subhead">Mission type</span>
            <select
              className="input"
              value={missionType}
              onChange={(e) => updateMission(e.target.value as MissionType)}
            >
              {MISSION_ORDER.map((m) => (
                <option key={m} value={m}>
                  {MISSION_LABELS[m]}. {MISSION_BLURBS[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="stack-1">
            <span className="subhead">Status</span>
            <select
              className="input"
              value={status}
              onChange={(e) =>
                updateStatus(e.target.value as "draft" | "active" | "archived")
              }
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </div>
        <label className="stack-1">
          <span className="subhead">Mission notes (optional)</span>
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Anything specific about what this team is for."
          />
        </label>
      </section>

      <section className="card stack-3">
        <div className="card-header">
          <h2>Roster</h2>
          <span className="caption">
            {roster.length} {roster.length === 1 ? "person" : "people"}
          </span>
        </div>
        {roster.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No one on the roster yet. Add people below to see the evaluation.
          </p>
        ) : (
          <div className="stack-3">
            {roster.map((r) => {
              const person = eligibleById.get(r.profile_id);
              if (!person) return null;
              const topTwo = person.profile
                ? [...person.profile.sub_strengths]
                    .sort((a, b) => b.energy - a.energy)
                    .slice(0, 2)
                : [];
              const others = otherActiveTeams[r.profile_id] ?? 0;
              return (
                <div
                  key={r.profile_id}
                  className="stack-2"
                  style={{
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: 12,
                  }}
                >
                  <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
                    <div className="stack-1" style={{ minWidth: 0 }}>
                      <strong>
                        {person.first_name} {person.last_name}
                      </strong>
                      <div className="caption">{person.position ?? ""}</div>
                    </div>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      {topTwo.map((s) => (
                        <span
                          key={s.sub_strength}
                          className="chip chip-sky"
                          title={`Energy ${s.energy}`}
                        >
                          {SUB_STRENGTH_LABELS[s.sub_strength] ?? s.sub_strength}
                        </span>
                      ))}
                      {others > 0 && (
                        <span
                          className="chip chip-warning"
                          title="Also on other active teams."
                        >
                          Also on {others} other{" "}
                          {others === 1 ? "team" : "teams"}
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost sm"
                        onClick={() => removeMember(r.profile_id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!showPicker ? (
          <div>
            <button
              type="button"
              className="btn btn-primary sm"
              onClick={() => setShowPicker(true)}
            >
              Add person
            </button>
          </div>
        ) : (
          <div className="stack-3">
            <input
              className="input"
              type="text"
              value={search}
              placeholder="Search by name or position"
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <div
              className="stack-2"
              style={{ maxHeight: 380, overflowY: "auto" }}
            >
              {filteredEligible.length === 0 && (
                <p className="muted" style={{ margin: 0 }}>
                  Nobody matches.
                </p>
              )}
              {filteredEligible.map((p) => {
                const complete = p.assessment_status === "completed";
                const topTwo = p.profile
                  ? [...p.profile.sub_strengths]
                      .sort((a, b) => b.energy - a.energy)
                      .slice(0, 2)
                  : [];
                return (
                  <div
                    key={p.id}
                    className="spread"
                    style={{
                      gap: 8,
                      flexWrap: "wrap",
                      padding: 12,
                      background: complete
                        ? "var(--surface)"
                        : "var(--aims-navy-tint)",
                      opacity: complete ? 1 : 0.65,
                      borderRadius: 10,
                    }}
                  >
                    <div className="stack-1" style={{ minWidth: 0 }}>
                      <strong>
                        {p.first_name} {p.last_name}
                      </strong>
                      <div className="caption">{p.position ?? ""}</div>
                    </div>
                    <div
                      className="row"
                      style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}
                    >
                      {complete ? (
                        topTwo.map((s) => (
                          <span
                            key={s.sub_strength}
                            className="chip chip-sky"
                            title={`Energy ${s.energy}`}
                          >
                            {SUB_STRENGTH_LABELS[s.sub_strength] ??
                              s.sub_strength}
                          </span>
                        ))
                      ) : (
                        <span className="chip chip-muted">
                          Awaiting assessment
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn btn-primary sm"
                        disabled={!complete}
                        onClick={() => complete && addMember(p.id)}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div>
              <button
                type="button"
                className="btn btn-ghost sm"
                onClick={() => {
                  setShowPicker(false);
                  setSearch("");
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </section>

      <EvaluationSection
        missionType={missionType}
        signals={signals}
        eligibleById={eligibleById}
        narrative={narrative}
        narrativeState={narrativeState}
        narrativeError={narrativeError}
        onRegenerate={() => fetchNarrative(true)}
        currentHashMatches={narrativeHash === currentHash}
      />
    </div>
  );
}

function EvaluationSection({
  missionType,
  signals,
  eligibleById,
  narrative,
  narrativeState,
  narrativeError,
  onRegenerate,
  currentHashMatches,
}: {
  missionType: MissionType;
  signals: TeamSignals | null;
  eligibleById: Map<string, EligiblePerson>;
  narrative: string | null;
  narrativeState: "idle" | "pending" | "generating" | "error";
  narrativeError: string | null;
  onRegenerate: () => void;
  currentHashMatches: boolean;
}) {
  if (!signals) {
    return (
      <section className="card stack-3">
        <div className="card-header">
          <h2>Evaluation</h2>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Add at least one person with a completed assessment to see the
          evaluation.
        </p>
      </section>
    );
  }

  const nameOf = (id: string) => {
    const p = eligibleById.get(id);
    return p ? p.first_name : id;
  };

  const soleHolders = signals.sub_strengths.filter(
    (s) => s.state === "sole_holder",
  );

  return (
    <section className="card stack-4">
      <div className="card-header">
        <h2>Evaluation</h2>
        <span className="caption">
          Weighted for <strong>{MISSION_LABELS[missionType]}</strong>
        </span>
      </div>

      <div className="stack-3">
        <div className="stack-1">
          <div className="subhead">Overall fit</div>
          <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span
              className={`chip ${bandChipClass(signals.band)}`}
              style={{ fontSize: 14, padding: "6px 14px" }}
            >
              {BAND_LABELS[signals.band]}
            </span>
            <span className="caption" style={{ maxWidth: "60ch" }}>
              {BAND_HELP[signals.band]}
            </span>
          </div>
        </div>
      </div>

      <div className="stack-3">
        <div className="subhead">Dimension coverage, weighted for the mission</div>
        <div className="stack-3">
          {DIM_ORDER.map((dim) => {
            const d = signals.dimensions.find((x) => x.dimension === dim);
            if (!d) return null;
            const depthPct = Math.max(0, Math.min(100, (d.depth / 5) * 100));
            return (
              <div key={dim} className="stack-1">
                <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <strong>{DIMENSION_LABELS[dim]}</strong>{" "}
                    <span className="caption">
                      weight {d.mission_weight.toFixed(2)} · {d.coverage_count}{" "}
                      {d.coverage_count === 1 ? "person" : "people"} at high energy · depth {d.depth.toFixed(1)}
                    </span>
                  </div>
                  {d.gap && (
                    <span className="chip chip-warning" title="No one on the roster has energy of 4 or higher in this dimension.">
                      Gap
                    </span>
                  )}
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill bar-energy"
                    style={{
                      width: `${depthPct}%`,
                      opacity: d.gap ? 0.5 : 1,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {(soleHolders.length > 0 ||
        signals.draining_warnings.length > 0 ||
        signals.overallocated.length > 0 ||
        signals.orientation_note !== "balanced" ||
        signals.duplications.length > 0) && (
        <div className="stack-3">
          <div className="subhead">Important Signals</div>
          <div className="stack-2">
            {soleHolders.length > 0 && (
              <ChipRow
                title="Held by only one person"
                caption="A dependency risk. Worth naming who could back them up."
                items={soleHolders.map((s) => ({
                  key: `sole-${s.sub_strength}-${s.holder}`,
                  className: "chip chip-warning",
                  label: `${nameOf(s.holder ?? "")} · ${
                    SUB_STRENGTH_LABELS[s.sub_strength] ?? s.sub_strength
                  }`,
                }))}
              />
            )}
            {signals.draining_warnings.length > 0 && (
              <ChipRow
                title="Capable but draining"
                caption="Strong competence, low energy on a sub-strength this mission leans on. Configure the load."
                items={signals.draining_warnings.map((w) => ({
                  key: `drain-${w.profile_id}-${w.sub_strength}`,
                  className: "chip chip-sky",
                  label: `${nameOf(w.profile_id)} · ${
                    SUB_STRENGTH_LABELS[w.sub_strength] ?? w.sub_strength
                  }`,
                }))}
              />
            )}
            {signals.overallocated.length > 0 && (
              <ChipRow
                title="Already on other active teams"
                caption="Not a block. Check whether the mix of commitments is sustainable."
                items={signals.overallocated.map((o) => ({
                  key: `over-${o.profile_id}`,
                  className: "chip chip-muted",
                  label: `${nameOf(o.profile_id)} · also on ${o.other_active_teams} other ${
                    o.other_active_teams === 1 ? "team" : "teams"
                  }`,
                }))}
              />
            )}
            {signals.orientation_note !== "balanced" && (
              <ChipRow
                title={ORIENTATION_NOTE_LABELS[signals.orientation_note]}
                caption={ORIENTATION_NOTE_HELP[signals.orientation_note]}
                items={[]}
              />
            )}
            {signals.duplications.length > 0 && (
              <ChipRow
                title="Duplicated coverage"
                caption="Three or more people at high energy on the same sub-strength. Not a problem, but a place to notice you may be doubling up."
                items={signals.duplications.map((sub) => ({
                  key: `dup-${sub}`,
                  className: "chip chip-muted",
                  label: SUB_STRENGTH_LABELS[sub] ?? sub,
                }))}
              />
            )}
          </div>
        </div>
      )}

      <div className="stack-3">
        <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
          <div className="subhead">Team Insights</div>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            {narrativeState === "pending" && (
              <span className="caption">
                Roster changed. Rebuilding shortly...
              </span>
            )}
            {narrativeState === "generating" && (
              <span className="caption">Rebuilding insights...</span>
            )}
            {narrativeState === "idle" && currentHashMatches && narrative && (
              <span className="caption">Up to date</span>
            )}
            <button
              type="button"
              className="btn btn-ghost sm"
              onClick={onRegenerate}
              disabled={narrativeState === "generating"}
            >
              Update now
            </button>
          </div>
        </div>
        {narrativeError && <div className="field-error">{narrativeError}</div>}
        {narrative ? (
          <NarrativeParagraphs
            text={narrative}
            highlights={buildHighlights(eligibleById)}
          />
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Team insights appear here after the roster settles.
          </p>
        )}
      </div>
    </section>
  );
}

function ChipRow({
  title,
  caption,
  items,
}: {
  title: string;
  caption: string;
  items: { key: string; className: string; label: string }[];
}) {
  return (
    <div className="stack-1">
      <strong>{title}</strong>
      <p className="caption" style={{ margin: 0 }}>
        {caption}
      </p>
      {items.length > 0 && (
        <div className="row-wrap">
          {items.map((it) => (
            <span key={it.key} className={it.className}>
              {it.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function NarrativeParagraphs({
  text,
  highlights,
}: {
  text: string;
  highlights: string[];
}) {
  const paragraphs = text
    .replace(/\\n/g, "\n")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div style={{ lineHeight: 1.7 }}>
      {paragraphs.map((p, i) => (
        <p key={i} style={{ margin: i === 0 ? 0 : "1.5em 0 0" }}>
          {boldMatches(p, highlights)}
        </p>
      ))}
    </div>
  );
}

// Wraps every occurrence of a known name / sub-strength / dimension label in
// <strong>. Match is case-insensitive; original casing is preserved. Longer
// keywords match first so full names win over first names.
function boldMatches(text: string, keywords: string[]): React.ReactNode[] {
  const cleaned = keywords.filter((k) => k && k.trim().length > 0);
  if (cleaned.length === 0) return [text];
  const escaped = cleaned
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[-\\/\\^$*+?.()|[\]{}]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
  );
}

// Names (first + full) plus every sub-strength and dimension label.
function buildHighlights(
  eligibleById: Map<string, EligiblePerson>,
): string[] {
  const names: string[] = [];
  for (const p of eligibleById.values()) {
    const full = `${p.first_name} ${p.last_name}`.trim();
    if (full && full !== p.first_name) names.push(full);
    if (p.first_name) names.push(p.first_name);
  }
  return Array.from(
    new Set([
      ...names,
      ...Object.values(SUB_STRENGTH_LABELS),
      ...Object.values(DIMENSION_LABELS),
    ]),
  );
}

function bandChipClass(band: TeamSignals["band"]) {
  if (band === "strong") return "chip-primary";
  if (band === "workable") return "chip-sky";
  return "chip-warning";
}
