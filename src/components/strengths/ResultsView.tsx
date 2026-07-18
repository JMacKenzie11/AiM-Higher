import Link from "next/link";
import {
  DIMENSION_LABELS,
  FLAG_LABELS,
  SUB_STRENGTH_LABELS,
  type Dimension,
  type Flag,
  type ResultsProfile,
} from "@/lib/strengths/types";

export default function ResultsView({
  firstName,
  results,
  showCoachingLink,
  banner,
}: {
  firstName: string;
  results: { profile: ResultsProfile; summary: string };
  showCoachingLink: boolean;
  banner?: React.ReactNode;
}) {
  const { profile, summary } = results;
  const dimensionOrder: Dimension[] = [
    "thinking",
    "influence",
    "execution",
    "relating",
  ];
  const dimensionMap = new Map(
    profile.dimensions.map((d) => [d.dimension, d]),
  );
  const groupedSubs = dimensionOrder
    .map((d) => ({
      dimension: d,
      subs: profile.sub_strengths
        .filter((s) => s.dimension === d)
        .sort((a, b) => b.competence + b.energy - (a.competence + a.energy)),
    }))
    .filter((g) => g.subs.length > 0);

  const topStrengths = profile.top_strengths ?? [];
  const summaryParagraphs = summary
    .replace(/\\n/g, "\n")
    .split(/\n+/)
    .map((p) => humanize(p.trim()))
    .filter(Boolean);

  return (
    <div className="stack-6">
      <section className="hero-bg">
        <div className="stack-4">
          <div className="subhead">Strengths results</div>
          <h1 className="chartreuse-underline">Your strengths, {firstName}</h1>
          {topStrengths.length > 0 && (
            <div className="stack-2">
              <div className="subhead">Where you're at your strongest</div>
              <div className="row-wrap">
                {topStrengths.map((s) => (
                  <span key={s} className="chip chip-primary">
                    {SUB_STRENGTH_LABELS[s] ?? s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {showCoachingLink && (
            <Link href="/coach" className="btn btn-primary lg" style={{ alignSelf: "flex-start" }}>
              Talk through your results
            </Link>
          )}
        </div>
      </section>

      {banner}

      <section className="card stack-3">
        <h2 className="chartreuse-underline">{firstName}, at a glance</h2>
        <div style={{ lineHeight: 1.7 }}>
          {summaryParagraphs.map((p, i) => (
            <p key={i} style={{ margin: i === 0 ? 0 : "1.5em 0 0" }}>
              {boldStrengths(p)}
            </p>
          ))}
        </div>
      </section>

      <section className="card stack-4">
        <h2 className="chartreuse-underline">Where your energy sits</h2>
        <p className="muted">
          Competence and energy read separately for each dimension. The gap
          between them is the interesting part.
        </p>
        <div className="stack-4">
          {dimensionOrder.map((d) => {
            const dim = dimensionMap.get(d);
            if (!dim) return null;
            return (
              <div key={d} className="stack-2">
                <div className="spread">
                  <strong>{DIMENSION_LABELS[d]}</strong>
                  <span className="faint" style={{ font: "var(--text-caption)" }}>
                    Competence {dim.competence_avg.toFixed(1)} · Energy {dim.energy_avg.toFixed(1)}
                  </span>
                </div>
                <DoubleBar
                  competence={dim.competence_avg}
                  energy={dim.energy_avg}
                />
              </div>
            );
          })}
        </div>
      </section>

      <section className="card stack-4">
        <h2 className="chartreuse-underline">The sixteen sub-strengths</h2>
        <div className="stack-5">
          {groupedSubs.map((g) => (
            <div key={g.dimension} className="stack-3">
              <div className="subhead">{DIMENSION_LABELS[g.dimension]}</div>
              <div className="stack-3">
                {g.subs.map((s) => (
                  <SubStrengthRow key={s.sub_strength} sub={s} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card stack-4">
        <h2 className="chartreuse-underline">How you apply your strengths</h2>
        <OrientationSpectrum
          lean={profile.orientation.lean}
          score={profile.orientation.score}
        />
        <p>
          Overall you lean <strong>{profile.orientation.lean}</strong>. Direct means you tend to bring the result yourself. Facilitative means you tend to draw the result out of the team.
        </p>
      </section>

      {profile.divergences?.length > 0 && (
        <section className="card stack-3">
          <h2 className="chartreuse-underline">Worth exploring</h2>
          <p className="muted">
            Where your story and your scores didn't quite line up.
          </p>
          <div className="stack-3">
            {profile.divergences.map((d) => (
              <div key={d.sub_strength} className="stack-1">
                <strong>{SUB_STRENGTH_LABELS[d.sub_strength] ?? d.sub_strength}</strong>
                <div>{boldStrengths(humanize(d.note))}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// Replaces raw sub-strength / dimension ids like "building_trust" or
// "relating" with their human-readable labels. Belt-and-braces for the
// occasional Claude output that leaks a snake_case id despite the system
// prompt telling it not to.
function humanize(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [id, label] of Object.entries(SUB_STRENGTH_LABELS)) {
    const re = new RegExp(`\\b${id}\\b`, "g");
    out = out.replace(re, label);
  }
  for (const [id, label] of Object.entries(DIMENSION_LABELS)) {
    const re = new RegExp(`\\b${id}\\b`, "gi");
    out = out.replace(re, label);
  }
  return out;
}

// Wraps every occurrence of a sub-strength or dimension label in <strong>.
// Longest-first match order so multi-word labels beat their component words.
function boldStrengths(text: string): React.ReactNode[] {
  const labels = [
    ...Object.values(SUB_STRENGTH_LABELS),
    ...Object.values(DIMENSION_LABELS),
  ].filter((k) => k && k.trim().length > 0);
  if (labels.length === 0) return [text];
  const escaped = labels
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[-\\/\\^$*+?.()|[\]{}]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "g");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
  );
}

function DoubleBar({
  competence,
  energy,
}: {
  competence: number;
  energy: number;
}) {
  return (
    <div className="stack-1">
      <div className="row" style={{ gap: 12 }}>
        <span
          className="subhead"
          style={{ flex: "0 0 110px", color: "var(--aims-cobalt)" }}
        >
          Competence
        </span>
        <div className="bar-track" style={{ flex: 1 }}>
          <div
            className="bar-fill bar-competence"
            style={{ width: `${(competence / 5) * 100}%` }}
          />
        </div>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <span
          className="subhead"
          style={{ flex: "0 0 110px", color: "var(--aims-sky)" }}
        >
          Energy
        </span>
        <div className="bar-track" style={{ flex: 1 }}>
          <div
            className="bar-fill bar-energy"
            style={{ width: `${(energy / 5) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SubStrengthRow({
  sub,
}: {
  sub: ResultsProfile["sub_strengths"][number];
}) {
  const flag = sub.flag as Flag;
  const chipClass =
    flag === "signature"
      ? "chip chip-primary"
      : flag === "capable_but_draining"
        ? "chip chip-warning"
        : flag === "hidden_pull"
          ? "chip chip-sky"
          : "chip chip-muted";

  return (
    <div className="stack-2" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
      <div className="spread" style={{ flexWrap: "wrap" }}>
        <strong>{SUB_STRENGTH_LABELS[sub.sub_strength] ?? sub.sub_strength}</strong>
        <span className={chipClass}>{FLAG_LABELS[flag]}</span>
      </div>
      <DoubleBar competence={sub.competence} energy={sub.energy} />
      {sub.narrative_evidence && (
        <div
          className="muted"
          style={{
            borderLeft: "3px solid var(--aims-chartreuse)",
            paddingLeft: 12,
            fontStyle: "italic",
          }}
        >
          "{sub.narrative_evidence}"
        </div>
      )}
    </div>
  );
}

function OrientationSpectrum({
  lean,
  score,
}: {
  lean: "direct" | "balanced" | "facilitative";
  score: number;
}) {
  const pct = ((score - 1) / 3) * 100;
  return (
    <div className="stack-3">
      <div
        style={{
          position: "relative",
          height: 12,
          background: "var(--aims-navy-tint)",
          borderRadius: "var(--radius-pill)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -6,
            left: `calc(${pct}% - 10px)`,
            width: 20,
            height: 24,
            background: "var(--aims-navy)",
            borderRadius: "var(--radius-pill)",
            boxShadow: "var(--shadow-sm)",
          }}
          aria-label={`Orientation lean: ${lean}`}
        />
      </div>
      <div className="spread">
        <span className="subhead">Direct</span>
        <span className="subhead">Facilitative</span>
      </div>
    </div>
  );
}
