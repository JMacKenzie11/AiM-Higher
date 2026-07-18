"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DIMENSION_LABELS,
  SUB_STRENGTH_LABELS,
  type Dimension,
  type ResultsProfile,
} from "@/lib/strengths/types";
import {
  scoreTeam,
  type Member,
  type MissionType,
  type OverallocationInput,
  type TeamSignals,
} from "@/lib/strengths/team-scoring";
import {
  MISSION_LABELS,
  MISSION_BLURBS,
  BAND_LABELS,
  BAND_HELP,
  ORIENTATION_NOTE_LABELS,
  ORIENTATION_NOTE_HELP,
} from "@/lib/strengths/team-labels";

export type EligiblePerson = {
  id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  assessment_status: "not_started" | "in_progress" | "completed";
  profile: ResultsProfile | null;
};

type ProposedMember = {
  profile_id: string;
  pinned: boolean;
  reason: string;
};

const MISSION_ORDER: MissionType[] = [
  "launch",
  "stabilize",
  "turnaround",
  "growth",
  "general",
];

const DIM_ORDER: Dimension[] = [
  "thinking",
  "influence",
  "execution",
  "relating",
];

export default function RecommendPage({
  isSystemAdmin,
  defaultCompanyId,
  companies,
  eligible,
}: {
  isSystemAdmin: boolean;
  defaultCompanyId: string;
  companies: { id: string; name: string }[];
  eligible: EligiblePerson[];
}) {
  const router = useRouter();

  // ----- Form state -----
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [name, setName] = useState("");
  const [missionType, setMissionType] = useState<MissionType>("launch");
  const [missionNotes, setMissionNotes] = useState("");
  const [targetSize, setTargetSize] = useState(4);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [pinnedFilter, setPinnedFilter] = useState("");
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [excludedFilter, setExcludedFilter] = useState("");

  // ----- Recommendation state -----
  const [proposal, setProposal] = useState<{
    roster: ProposedMember[];
    narrative: string;
  } | null>(null);
  const [runState, setRunState] = useState<"idle" | "running" | "error">("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Swap UI
  const [swapForId, setSwapForId] = useState<string | null>(null);
  const [swapSearch, setSwapSearch] = useState("");

  // ----- Derived data -----
  const eligibleById = useMemo(
    () => new Map(eligible.map((p) => [p.id, p])),
    [eligible],
  );

  const completedEligible = useMemo(
    () => eligible.filter((p) => p.assessment_status === "completed"),
    [eligible],
  );

  // Live signals: derived from the current proposal (or null if none yet).
  const signals: TeamSignals | null = useMemo(() => {
    if (!proposal) return null;
    const members: Member[] = proposal.roster
      .map((r) => {
        const p = eligibleById.get(r.profile_id);
        return p?.profile
          ? { profile_id: r.profile_id, results: p.profile }
          : null;
      })
      .filter((m): m is Member => !!m);
    if (members.length === 0) return null;
    const overallocation: OverallocationInput[] = members.map((m) => ({
      profile_id: m.profile_id,
      other_active_teams: 0, // Best-effort: recompute server-side on save.
    }));
    return scoreTeam(members, missionType, overallocation);
  }, [proposal, missionType, eligibleById]);

  // The narrative goes stale as soon as the roster changes locally (swap).
  const [narrativeStale, setNarrativeStale] = useState(false);

  // ----- Form actions -----
  function togglePin(id: string) {
    // Pinning and excluding are mutually exclusive.
    setExcludedIds((prev) => prev.filter((x) => x !== id));
    setPinnedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  function toggleExclude(id: string) {
    setPinnedIds((prev) => prev.filter((x) => x !== id));
    setExcludedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function runRecommendation() {
    if (!missionType || targetSize <= 0) return;
    if (!companyId) {
      setRunError("Pick a company.");
      return;
    }
    if (completedEligible.length === 0) {
      setRunError("No one in this company has a completed assessment yet.");
      return;
    }
    setRunState("running");
    setRunError(null);
    setProposal(null);
    const res = await fetch("/api/teams/recommend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        company_id: companyId,
        mission_type: missionType,
        mission_notes: missionNotes,
        target_size: targetSize,
        pinned_ids: pinnedIds,
        excluded_ids: excludedIds,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRunError(data.error ?? "Couldn't build a recommendation.");
      setRunState("error");
      return;
    }
    const data = (await res.json()) as {
      roster: ProposedMember[];
      narrative: string;
    };
    setProposal(data);
    setNarrativeStale(false);
    setRunState("idle");
  }

  async function refreshNarrative() {
    if (!proposal) return;
    setRunState("running");
    setRunError(null);
    const res = await fetch("/api/teams/recommend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        company_id: companyId,
        mission_type: missionType,
        mission_notes: missionNotes,
        target_size: proposal.roster.length,
        pinned_ids: pinnedIds,
        excluded_ids: excludedIds,
        selected_ids: proposal.roster.map((r) => r.profile_id),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRunError(data.error ?? "Couldn't rebuild the read.");
      setRunState("error");
      return;
    }
    const data = (await res.json()) as {
      roster: ProposedMember[];
      narrative: string;
    };
    setProposal(data);
    setNarrativeStale(false);
    setRunState("idle");
  }

  function swapMember(oldId: string, newId: string) {
    if (!proposal) return;
    const p = eligibleById.get(newId);
    if (!p?.profile) return;
    const newRoster = proposal.roster.map((r) =>
      r.profile_id === oldId
        ? {
            profile_id: newId,
            pinned: false,
            reason: (() => {
              const top = [...p.profile!.sub_strengths]
                .sort((a, b) => b.energy - a.energy)
                .slice(0, 2)
                .map(
                  (s) => SUB_STRENGTH_LABELS[s.sub_strength] ?? s.sub_strength,
                );
              return `Brings ${top.join(" and ")} at high energy.`;
            })(),
          }
        : r,
    );
    setProposal({ roster: newRoster, narrative: proposal.narrative });
    setNarrativeStale(true);
    setSwapForId(null);
    setSwapSearch("");
  }

  function removeMember(id: string) {
    if (!proposal) return;
    setProposal({
      ...proposal,
      roster: proposal.roster.filter((r) => r.profile_id !== id),
    });
    setNarrativeStale(true);
  }

  async function saveTeam() {
    if (!proposal || !name.trim() || !companyId) return;
    setSaving(true);
    setSaveError(null);
    // Create team
    const teamRes = await fetch("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        mission_type: missionType,
        mission_notes: missionNotes,
        company_id: companyId,
      }),
    });
    if (!teamRes.ok) {
      const data = await teamRes.json().catch(() => ({}));
      setSaveError(data.error ?? "Couldn't create the team.");
      setSaving(false);
      return;
    }
    const { id: teamId } = (await teamRes.json()) as { id: string };
    // Add members sequentially so pinned status is preserved.
    for (const r of proposal.roster) {
      await fetch(`/api/teams/${teamId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile_id: r.profile_id, pinned: r.pinned }),
      });
    }
    router.push(`/admin/teams/${teamId}`);
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const rosterIds = new Set(proposal?.roster.map((r) => r.profile_id) ?? []);

  const pinnedFilterQuery = pinnedFilter.trim().toLowerCase();
  const visiblePinnedCandidates =
    pinnedFilterQuery.length > 0
      ? completedEligible.filter((p) =>
          `${p.first_name} ${p.last_name}`
            .toLowerCase()
            .includes(pinnedFilterQuery),
        )
      : completedEligible;

  const excludedFilterQuery = excludedFilter.trim().toLowerCase();
  const visibleExcludedCandidates =
    excludedFilterQuery.length > 0
      ? completedEligible.filter((p) =>
          `${p.first_name} ${p.last_name}`
            .toLowerCase()
            .includes(excludedFilterQuery),
        )
      : completedEligible;

  return (
    <div className="stack-5">
      <section
        className="card"
        style={{
          padding: 40,
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h2>The mission</h2>
        </div>

        {/* Section 1: Team name + Company */}
        <div className="form-grid form-grid-2">
          <label className="stack-1">
            <span className="subhead">Team name</span>
            <input
              className="input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q3 launch pod"
            />
          </label>
          {isSystemAdmin && companies.length > 0 && (
            <label className="stack-1">
              <span className="subhead">Company</span>
              <select
                className="input"
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setProposal(null);
                  setPinnedIds([]);
                }}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* Section 2: Mission + Target size */}
        <div className="form-grid form-grid-2">
          <label className="stack-1">
            <span className="subhead">Mission</span>
            <select
              className="input"
              value={missionType}
              onChange={(e) => setMissionType(e.target.value as MissionType)}
            >
              {MISSION_ORDER.map((m) => (
                <option key={m} value={m}>
                  {MISSION_LABELS[m]}. {MISSION_BLURBS[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="stack-1">
            <span className="subhead">Target size</span>
            <input
              className="input"
              type="number"
              min={1}
              max={20}
              value={targetSize}
              onChange={(e) => setTargetSize(Number(e.target.value) || 4)}
            />
          </label>
        </div>

        {/* Section 3: Mission notes */}
        <label className="stack-1">
          <span className="subhead">Mission notes (optional)</span>
          <textarea
            className="input"
            rows={2}
            value={missionNotes}
            onChange={(e) => setMissionNotes(e.target.value)}
            placeholder="Anything specific about the work this team is being formed for."
          />
        </label>

        {/* Section 4: Must-include people, in its own sand-toned group */}
        <div className="stack-2">
          <div className="subhead">Must-include people (optional)</div>
          <p className="caption" style={{ margin: 0 }}>
            Pinned people are always on the roster. The system fills the rest.
          </p>
          <div
            style={{
              background: "var(--aims-sand)",
              borderRadius: 12,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {completedEligible.length > 10 && (
              <input
                type="text"
                className="input"
                placeholder="Filter by name"
                value={pinnedFilter}
                onChange={(e) => setPinnedFilter(e.target.value)}
                style={{ maxWidth: 320 }}
              />
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {completedEligible.length === 0 && (
                <span className="muted">
                  Nobody in this company has completed the assessment yet.
                </span>
              )}
              {completedEligible.length > 0 &&
                visiblePinnedCandidates.length === 0 && (
                  <span className="muted">
                    No one matches that filter.
                  </span>
                )}
              {visiblePinnedCandidates.map((p) => {
                const pinned = pinnedIds.includes(p.id);
                const excluded = excludedIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePin(p.id)}
                    className={`chip ${pinned ? "chip-primary" : "chip-muted"}`}
                    title={
                      excluded
                        ? "Currently excluded. Pinning will move them into the required list."
                        : (p.position ?? "")
                    }
                    style={{
                      cursor: "pointer",
                      opacity: excluded ? 0.5 : 1,
                    }}
                  >
                    {p.first_name} {p.last_name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section 4b: Exclude people */}
        <div className="stack-2">
          <div className="subhead">Exclude people (optional)</div>
          <p className="caption" style={{ margin: 0 }}>
            Excluded people are kept out of the recommendation. Handy when
            someone is on leave, isn't a fit for this mission, or already has
            too much on their plate.
          </p>
          <div
            style={{
              background: "var(--aims-sand)",
              borderRadius: 12,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {completedEligible.length > 10 && (
              <input
                type="text"
                className="input"
                placeholder="Filter by name"
                value={excludedFilter}
                onChange={(e) => setExcludedFilter(e.target.value)}
                style={{ maxWidth: 320 }}
              />
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {completedEligible.length === 0 && (
                <span className="muted">
                  Nobody in this company has completed the assessment yet.
                </span>
              )}
              {completedEligible.length > 0 &&
                visibleExcludedCandidates.length === 0 && (
                  <span className="muted">No one matches that filter.</span>
                )}
              {visibleExcludedCandidates.map((p) => {
                const excluded = excludedIds.includes(p.id);
                const pinned = pinnedIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleExclude(p.id)}
                    className={`chip ${excluded ? "chip-warning" : "chip-muted"}`}
                    title={
                      pinned
                        ? "Currently required. Excluding will move them out of the required list."
                        : (p.position ?? "")
                    }
                    style={{
                      cursor: "pointer",
                      opacity: pinned ? 0.5 : 1,
                      textDecoration: excluded ? "line-through" : "none",
                    }}
                  >
                    {p.first_name} {p.last_name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section 5: Explainer block */}
        <div className="stack-2">
          <div className="subhead">How the recommendation works</div>
          <p className="muted" style={{ margin: 0 }}>
            The recommendation reads each person's assessment, which measures
            two things separately: what they're good at and what gives them
            energy. It builds a roster that covers the full arc of this
            mission, from generating ideas to aligning people to driving the
            work to done. It leans hardest on strengths where capability and
            energy come together. When someone has energy for something but
            hasn't fully developed the skill yet, it counts that as promise,
            not proven strength. It won't build a team that depends on work
            someone is good at but that drains them. It also names where the
            team has the most room to grow, because every real team has
            somewhere to develop into.
          </p>
        </div>

        {runError && <div className="field-error">{runError}</div>}

        {/* Section 6: Submit */}
        <div>
          <button
            type="button"
            className="btn btn-primary lg"
            onClick={runRecommendation}
            disabled={runState === "running"}
          >
            {runState === "running"
              ? "Building a recommendation..."
              : proposal
                ? "Rebuild recommendation"
                : "Recommend a roster"}
          </button>
        </div>
      </section>

      {proposal && (
        <>
          <section className="card stack-3">
            <div className="card-header">
              <h2>Proposed roster</h2>
              <span className="caption">
                {proposal.roster.length}{" "}
                {proposal.roster.length === 1 ? "person" : "people"}
              </span>
            </div>
            <p className="caption" style={{ margin: 0 }}>
              One line per person on why they're on this roster. Swap or remove
              anyone. The read updates when you're settled.
            </p>
            <div className="stack-3">
              {proposal.roster.map((r) => {
                const person = eligibleById.get(r.profile_id);
                if (!person) return null;
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
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <strong>
                            {person.first_name} {person.last_name}
                          </strong>
                          {r.pinned && (
                            <span className="chip chip-primary">Pinned</span>
                          )}
                        </div>
                        <div className="caption">{person.position ?? ""}</div>
                        <div className="muted" style={{ fontSize: 14 }}>
                          {r.reason}
                        </div>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <button
                          type="button"
                          className="btn btn-ghost sm"
                          onClick={() =>
                            setSwapForId(
                              swapForId === r.profile_id ? null : r.profile_id,
                            )
                          }
                        >
                          {swapForId === r.profile_id ? "Cancel swap" : "Swap"}
                        </button>
                        {!r.pinned && (
                          <button
                            type="button"
                            className="btn btn-ghost sm"
                            onClick={() => removeMember(r.profile_id)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    {swapForId === r.profile_id && (
                      <SwapPicker
                        search={swapSearch}
                        onSearchChange={setSwapSearch}
                        candidates={eligible.filter(
                          (p) =>
                            !rosterIds.has(p.id) || p.id === r.profile_id,
                        )}
                        onPick={(newId) => swapMember(r.profile_id, newId)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <EvaluationSection
            missionType={missionType}
            signals={signals}
            eligibleById={eligibleById}
            narrative={proposal.narrative}
            narrativeStale={narrativeStale}
            runState={runState}
            runError={runError}
            onRefreshNarrative={refreshNarrative}
          />

          <section className="card stack-3">
            <div className="card-header">
              <h2>Save this team</h2>
            </div>
            <p className="caption" style={{ margin: 0 }}>
              Nothing is saved yet. Confirming creates a draft team with this
              roster; you can edit it further in build mode afterwards.
            </p>
            {saveError && <div className="field-error">{saveError}</div>}
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary lg"
                disabled={
                  saving ||
                  !name.trim() ||
                  proposal.roster.length === 0 ||
                  narrativeStale
                }
                title={
                  narrativeStale
                    ? "Refresh the read to match the current roster before saving."
                    : undefined
                }
                onClick={saveTeam}
              >
                {saving ? "Saving..." : "Confirm and save as draft"}
              </button>
              <button
                type="button"
                className="btn btn-ghost lg"
                onClick={() => router.push("/admin/teams")}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SwapPicker({
  search,
  onSearchChange,
  candidates,
  onPick,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  candidates: EligiblePerson[];
  onPick: (id: string) => void;
}) {
  const filtered = candidates.filter((p) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
      (p.position ?? "").toLowerCase().includes(q)
    );
  });
  return (
    <div className="stack-2" style={{ background: "var(--aims-navy-tint)", padding: 12, borderRadius: 10 }}>
      <input
        className="input"
        type="text"
        placeholder="Search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        autoFocus
      />
      <div style={{ maxHeight: 320, overflowY: "auto" }} className="stack-1">
        {filtered.length === 0 && (
          <span className="muted">Nobody matches.</span>
        )}
        {filtered.map((p) => {
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
                padding: 8,
                background: complete ? "var(--surface)" : "transparent",
                opacity: complete ? 1 : 0.6,
                borderRadius: 8,
                flexWrap: "wrap",
              }}
            >
              <div className="stack-1" style={{ minWidth: 0 }}>
                <strong>
                  {p.first_name} {p.last_name}
                </strong>
                <div className="caption">{p.position ?? ""}</div>
              </div>
              <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {complete ? (
                  topTwo.map((s) => (
                    <span key={s.sub_strength} className="chip chip-sky">
                      {SUB_STRENGTH_LABELS[s.sub_strength] ?? s.sub_strength}
                    </span>
                  ))
                ) : (
                  <span className="chip chip-muted">Awaiting assessment</span>
                )}
                <button
                  type="button"
                  className="btn btn-primary sm"
                  disabled={!complete}
                  onClick={() => complete && onPick(p.id)}
                >
                  Swap in
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EvaluationSection({
  missionType,
  signals,
  eligibleById,
  narrative,
  narrativeStale,
  runState,
  runError,
  onRefreshNarrative,
}: {
  missionType: MissionType;
  signals: TeamSignals | null;
  eligibleById: Map<string, EligiblePerson>;
  narrative: string;
  narrativeStale: boolean;
  runState: "idle" | "running" | "error";
  runError: string | null;
  onRefreshNarrative: () => void;
}) {
  if (!signals) return null;
  const nameOf = (id: string) => eligibleById.get(id)?.first_name ?? id;

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
                    <span className="chip chip-warning">Gap</span>
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
                caption="Strong competence, low energy on a sub-strength this mission leans on."
                items={signals.draining_warnings.map((w) => ({
                  key: `drain-${w.profile_id}-${w.sub_strength}`,
                  className: "chip chip-sky",
                  label: `${nameOf(w.profile_id)} · ${
                    SUB_STRENGTH_LABELS[w.sub_strength] ?? w.sub_strength
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
                caption="Three or more people at high energy on the same sub-strength."
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
            {narrativeStale && (
              <span className="caption">
                Roster changed. Refresh to update.
              </span>
            )}
            {runState === "running" && (
              <span className="caption">Rebuilding insights...</span>
            )}
            <button
              type="button"
              className="btn btn-ghost sm"
              onClick={onRefreshNarrative}
              disabled={runState === "running"}
            >
              {narrativeStale ? "Refresh insights" : "Rebuild insights"}
            </button>
          </div>
        </div>
        {runError && <div className="field-error">{runError}</div>}
        <NarrativeParagraphs
          text={narrative}
          highlights={buildHighlights(eligibleById)}
        />
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

// Collect every person name (first + full) plus every sub-strength and
// dimension label. Used to bold matching spans inside the narrative.
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
