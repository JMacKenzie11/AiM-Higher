import Link from "next/link";
import {
  DIMENSION_LABELS,
  FLAG_LABELS,
  SUB_STRENGTH_LABELS,
  type Dimension,
  type Flag,
  type ResultsProfile,
} from "@/lib/strengths/types";
import styles from "@/app/(app)/strengths/strengths.module.css";

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
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Your strengths">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Strengths results</p>
          <h1 className={styles.h1}>Your strengths, {firstName}</h1>
          <span className={styles.rule} aria-hidden="true" />
          {topStrengths.length > 0 ? (
            <div className={styles.stack2}>
              <p className={styles.subtitle}>Where you&rsquo;re at your strongest</p>
              <div className={styles.rowWrap}>
                {topStrengths.map((s) => (
                  <span key={s} className={`${styles.chip} ${styles.chipPrimary}`}>
                    {SUB_STRENGTH_LABELS[s] ?? s}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {showCoachingLink ? (
            <Link href="/coach" className={styles.primaryButton}>
              Talk through your results
            </Link>
          ) : null}
        </div>
      </section>

      <div className={styles.content}>
        {banner}

        <section className={styles.card} aria-labelledby="at-a-glance">
          <h2 id="at-a-glance" className={styles.h2}>
            {firstName}, at a glance
          </h2>
          <div className={styles.stack3}>
            {summaryParagraphs.map((p, i) => (
              <p key={i} className={styles.prose}>{boldStrengths(p)}</p>
            ))}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="where-energy-sits">
          <h2 id="where-energy-sits" className={styles.h2}>
            Where your energy sits
          </h2>
          <p className={styles.muted}>
            Competence and energy read separately for each dimension. The gap
            between them is the interesting part.
          </p>
          <div className={styles.stack4}>
            {dimensionOrder.map((d) => {
              const dim = dimensionMap.get(d);
              if (!dim) return null;
              return (
                <div key={d} className={styles.stack2}>
                  <div className={styles.spread}>
                    <strong>{DIMENSION_LABELS[d]}</strong>
                    <span className={styles.muted} style={{ font: "var(--text-caption)" }}>
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

        <section className={styles.card} aria-labelledby="sixteen">
          <h2 id="sixteen" className={styles.h2}>
            The sixteen sub-strengths
          </h2>
          <div className={styles.stack5}>
            {groupedSubs.map((g) => (
              <div key={g.dimension} className={styles.stack3}>
                <p className={styles.subhead}>{DIMENSION_LABELS[g.dimension]}</p>
                <div className={styles.stack3}>
                  {g.subs.map((s) => (
                    <SubStrengthRow key={s.sub_strength} sub={s} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="apply">
          <h2 id="apply" className={styles.h2}>
            How you apply your strengths
          </h2>
          <OrientationSpectrum
            lean={profile.orientation.lean}
            score={profile.orientation.score}
          />
          <p className={styles.prose}>
            Overall you lean <strong>{profile.orientation.lean}</strong>. Direct
            means you tend to bring the result yourself. Facilitative means you
            tend to draw the result out of the team.
          </p>
        </section>

        {profile.divergences?.length > 0 ? (
          <section className={styles.card} aria-labelledby="explore">
            <h2 id="explore" className={styles.h2}>
              Worth exploring
            </h2>
            <p className={styles.muted}>
              Where your story and your scores didn&rsquo;t quite line up.
            </p>
            <div className={styles.stack3}>
              {profile.divergences.map((d) => (
                <div key={d.sub_strength} className={styles.stack2}>
                  <strong>
                    {SUB_STRENGTH_LABELS[d.sub_strength] ?? d.sub_strength}
                  </strong>
                  <div>{boldStrengths(humanize(d.note))}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
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
    <div className={styles.stack2}>
      <div className={styles.barRow}>
        <span className={`${styles.barLabel} ${styles.barLabelCompetence}`}>
          Competence
        </span>
        <div className={styles.barTrack}>
          <div
            className={`${styles.barFill} ${styles.barCompetence}`}
            style={{ width: `${(competence / 5) * 100}%` }}
          />
        </div>
      </div>
      <div className={styles.barRow}>
        <span className={`${styles.barLabel} ${styles.barLabelEnergy}`}>Energy</span>
        <div className={styles.barTrack}>
          <div
            className={`${styles.barFill} ${styles.barEnergy}`}
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
  const chipVariant =
    flag === "signature"
      ? styles.chipPrimary
      : flag === "capable_but_draining"
        ? styles.chipWarning
        : flag === "hidden_pull"
          ? styles.chipSky
          : styles.chipMuted;

  return (
    <div className={styles.subStrengthRow}>
      <div className={styles.spread} style={{ flexWrap: "wrap" }}>
        <strong>{SUB_STRENGTH_LABELS[sub.sub_strength] ?? sub.sub_strength}</strong>
        <span className={`${styles.chip} ${chipVariant}`}>{FLAG_LABELS[flag]}</span>
      </div>
      <DoubleBar competence={sub.competence} energy={sub.energy} />
      {sub.narrative_evidence ? (
        <div className={styles.evidence}>&ldquo;{sub.narrative_evidence}&rdquo;</div>
      ) : null}
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
    <div className={styles.stack3}>
      <div className={styles.spectrumTrack}>
        <div
          className={styles.spectrumThumb}
          style={{ left: `calc(${pct}% - 10px)` }}
          aria-label={`Orientation lean: ${lean}`}
        />
      </div>
      <div className={styles.spread}>
        <span className={styles.subhead}>Direct</span>
        <span className={styles.subhead}>Facilitative</span>
      </div>
    </div>
  );
}
