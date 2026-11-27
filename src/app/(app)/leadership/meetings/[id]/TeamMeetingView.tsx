import Link from "next/link";
import type React from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AnalysisTabs } from "./AnalysisTabs";
import { RecapPlayer } from "@/app/(app)/dashboard/RecapPlayer";
import styles from "./team-meeting.module.css";
import type { StoredRubric } from "@/lib/leadership/rubric/stored";
import type { PageSectionKey, PageSummary } from "@/lib/transcripts/page-summary";
import type { MeetingScore } from "@/lib/leadership/facilitation/score";
import type { PartKey } from "@/lib/leadership/rubric/types";

// THE TEAM MEETING PAGE (2026-11-27). Jason: the prototype is the page,
// https://claude.ai/artifact/EUXjRn9fJaYqCEbLQFzJRe. Strengths first:
// every part reads as what went well and what would make it even
// better, never as what went wrong.
//
// A coaching call keeps its own page (page.tsx): private, and never
// scored. A meeting analysed before the rubric shows here too, with the
// score and summary it has.

export type PriorCommitment = {
  id: string;
  description: string;
  owner: string | null;
  state: "done" | "not_done" | "open";
};

export type TeamMeetingViewProps = {
  meetingId: string;
  title: string;
  dateLabel: string;
  attendeeCount: number;
  score: MeetingScore | null;
  rubric: StoredRubric | null;
  previousRubricValue: number | null;
  summary: PageSummary | null;
  summaryMarkdown: string;
  valuesMarkdown: string | null;
  truncated: boolean;
  newCommitments: number;
  issuesRaised: number;
  priorCommitments: PriorCommitment[];
  commitmentsTab: ReactNode;
  transcript: Array<{ speaker: string | null; words: string }>;
  banner: ReactNode;
  footer: ReactNode;
  // The meeting's score video (0331), when Grok Bot has handed one back.
  video: { embedUrl: string; poster: string | null } | null;
};

const SECTION_TITLES: Record<PageSectionKey, string> = {
  checkin: "Positive check-in",
  headlines: "Headlines",
  scorecard: "Critical Success Factors",
  priorities: "Goals and priorities",
  issues: "Solve together",
  commitments: "Commitments and close",
};

// The rubric part each agenda section is scored by.
const SECTION_PART: Record<PageSectionKey, PartKey> = {
  checkin: "checkin",
  headlines: "headlines",
  scorecard: "data",
  priorities: "priorities",
  issues: "dialogue",
  commitments: "operational",
};

// Short names for the score card's list; the full names are on How it
// was run.
const PART_SHORT: Record<PartKey, string> = {
  checkin: "Check-in",
  headlines: "Headlines",
  data: "Data",
  priorities: "Goals",
  operational: "Operational",
  dialogue: "Dialogue",
  focus: "Focus",
  container: "Container",
  structure: "Structure",
  engagement: "Engagement",
};

function scoreText(score: MeetingScore): string {
  if (score.kind === "rubric") return score.outOfTen;
  return score.value.toFixed(1);
}

function deltaLine(now: number, before: number): { text: string; up: boolean } {
  const d = Math.round((now - before) * 10) / 10;
  if (d > 0) return { text: `Up ${d.toFixed(1)} on the last meeting`, up: true };
  if (d < 0) return { text: `${Math.abs(d).toFixed(1)} below the last meeting`, up: false };
  return { text: "Same as the last meeting", up: false };
}

// The one step for next week: from the part with the most room to grow,
// its first "even better" step. Ties go to the earlier part.
function tryNextWeek(rubric: StoredRubric): { step: string; part: string } | null {
  let pick: StoredRubric["parts"][number] | null = null;
  for (const p of rubric.parts) {
    if (p.better.length === 0) continue;
    if (!pick || p.level < pick.level) pick = p;
  }
  // The count in brackets ("(0 of 1 this week)") is for the part's own
  // list; as a headline it reads as a tally, so it is left off here.
  return pick ? { step: pick.better[0].text.replace(/\s*\([^)]*\)(?=\.?$)/, ""), part: pick.name } : null;
}

function Tick() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ flex: "none", marginTop: 2 }} aria-hidden="true">
      <circle cx="9" cy="9" r="9" fill="#4C8A4F" />
      <path d="M5 9.2l2.6 2.6L13 6.4" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Step() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ flex: "none", marginTop: 2 }} aria-hidden="true">
      <circle cx="9" cy="9" r="8" fill="var(--aims-cobalt-tint)" />
      <path d="M9 13V5.5M5.8 8.5L9 5.3l3.2 3.2" stroke="var(--aims-cobalt)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TeamMeetingView(props: TeamMeetingViewProps) {
  const { rubric, summary, score } = props;
  const next = rubric ? tryNextWeek(rubric) : null;
  const delta =
    rubric && props.previousRubricValue !== null ? deltaLine(rubric.value, props.previousRubricValue) : null;
  const levelOf = (key: PartKey) => rubric?.parts.find((p) => p.key === key)?.level ?? null;
  const priorDone = props.priorCommitments.filter((c) => c.state === "done").length;

  const glance: Array<{ value: string; label: string }> = [];
  if (summary) glance.push({ value: String(summary.decisions.length), label: summary.decisions.length === 1 ? "decision" : "decisions" });
  glance.push({ value: String(props.newCommitments), label: props.newCommitments === 1 ? "new commitment" : "new commitments" });
  if (props.priorCommitments.length > 0)
    glance.push({ value: `${priorDone} of ${props.priorCommitments.length}`, label: "last week's done" });
  const issuesWorked = summary ? summary.issues.length : props.issuesRaised;
  glance.push({ value: String(issuesWorked), label: issuesWorked === 1 ? "issue worked" : "issues worked" });

  // ---- Summary tab ------------------------------------------------
  const summaryTab = (
    <div className={styles.cols}>
      <div className={styles.stack}>
        {summary ? (
          <>
            {summary.overview ? <p className={styles.overview}>{summary.overview}</p> : null}
            {summary.sections.map((sec, i) => {
              const level = levelOf(SECTION_PART[sec.part]);
              return (
                <section key={sec.part} className={`${styles.card} ${styles.section}`} aria-labelledby={`sec-${sec.part}`}>
                  <div className={styles.sectionHead}>
                    <span className={styles.sectionNum} aria-hidden="true">{i + 1}</span>
                    <h3 id={`sec-${sec.part}`} className={styles.h3}>{SECTION_TITLES[sec.part]}</h3>
                    <span className={styles.grow} />
                    {level !== null ? <span className={styles.chip}>{level} of 5</span> : null}
                  </div>
                  <ul className={styles.points}>
                    {sec.points.map((p, j) => (
                      <li key={j}>{p}</li>
                    ))}
                  </ul>
                  {sec.part === "issues" && summary.issues.length > 0 ? (
                    <div className={styles.issues}>
                      {summary.issues.map((is, j) => (
                        <div key={j} className={styles.issue}>
                          <span className={styles.issueTitle}>{is.title}</span>
                          <ul className={styles.ws} aria-label="Which of the 4Ws the meeting reached">
                            {(
                              [
                                ["What", is.what],
                                ["Want", is.want],
                                ["Way", is.way],
                                ["Who", is.who],
                              ] as const
                            ).map(([label, on]) => (
                              <li key={label} className={styles.w} data-on={on ? "true" : "false"}>
                                {label}
                                <span className={styles.srOnly}>{on ? ", reached" : ", not yet"}</span>
                              </li>
                            ))}
                          </ul>
                          {is.outcome ? <span className={styles.issueOutcome}>{is.outcome}</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </>
        ) : (
          <section className={`${styles.card} ${styles.section}`} aria-label="Summary">
            {props.truncated ? (
              <p className={styles.muted} role="status">
                This summary was cut short before it finished. The commitments and the score are complete, because
                they come from separate passes.
              </p>
            ) : null}
            {props.summaryMarkdown ? (
              <div className="aims-prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.summaryMarkdown}</ReactMarkdown>
              </div>
            ) : (
              <p className={styles.muted}>Summary not available.</p>
            )}
          </section>
        )}
      </div>

      <div className={styles.stack}>
        {summary && summary.decisions.length > 0 ? (
          <section className={`${styles.card} ${styles.side}`} aria-labelledby="decisions">
            <h3 id="decisions" className={styles.caps}>Decisions</h3>
            <ol className={styles.sideList}>
              {summary.decisions.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ol>
          </section>
        ) : null}

        {rubric?.talk.speakers && rubric.talk.speakers.length > 0 ? (
          <section className={`${styles.card} ${styles.side}`} aria-labelledby="who-spoke">
            <div className={styles.talkRow}>
              <h3 id="who-spoke" className={styles.caps}>Who spoke</h3>
              <span className={styles.muted}>Share of the talking</span>
            </div>
            <div className={styles.talk}>
              {rubric.talk.speakers.slice(0, 8).map((sp) => {
                const top = rubric.talk.speakers![0].share || 1;
                return (
                  <div key={sp.name}>
                    <div className={styles.talkRow}>
                      <span>{sp.name}</span>
                      <span className={styles.talkPct}>{Math.round(sp.share * 100)}%</span>
                    </div>
                    <div className={styles.track}>
                      <div className={styles.fill} style={{ width: `${Math.round((sp.share / top) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {summary && (summary.values_shown.length > 0 || summary.values_to_name.length > 0) ? (
          <section className={`${styles.card} ${styles.side}`} aria-labelledby="values">
            <h3 id="values" className={styles.caps}>Values in action</h3>
            {summary.values_shown.map((v, i) => (
              <div key={i} className={styles.value}>
                <strong className={styles.valueName}>{v.value}.</strong> {v.moment}
              </div>
            ))}
            {summary.values_to_name.map((v, i) => (
              <div key={`n${i}`} className={`${styles.value} ${styles.muted}`}>
                <strong className={styles.valueName}>A moment to name {v.value}.</strong> {v.moment}
              </div>
            ))}
          </section>
        ) : !summary && props.valuesMarkdown ? (
          <section className={`${styles.card} ${styles.side}`} aria-labelledby="values">
            <h3 id="values" className={styles.caps}>Values in action</h3>
            <div className="aims-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.valuesMarkdown}</ReactMarkdown>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );

  // ---- How it was run tab -----------------------------------------
  const runTab = rubric ? (
    <div>
      <div className={styles.runIntro}>
        <div className={`${styles.card} ${styles.runIntroCard}`}>
          <h2 className={styles.h2}>How the meeting was run</h2>
          <p className={styles.overview} style={{ marginTop: 8, fontSize: 14 }}>
            Each part is scored 1 to 5 against the AiMS facilitation rubric. Open a part to see what went well, and the
            next step that would take it even higher. The score comes from the same checks, so it always matches what
            you read here.
          </p>
        </div>
      </div>
      <div className={`${styles.card} ${styles.parts}`}>
        {rubric.parts.map((part, i) => (
          <details key={part.key} className={styles.part}>
            <summary className={styles.partHead}>
              <span className={styles.partNum}>{i + 1}</span>
              <span className={styles.grow} style={{ minWidth: 0 }}>
                <span className={styles.partName}>{part.name}</span>
                <span className={styles.partLine}>
                  {part.better.length > 0 ? `Next: ${part.better[0].text}` : "Every check met"}
                </span>
              </span>
              <span className={styles.dots} aria-hidden="true">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className={styles.dot} data-on={n <= part.level ? "true" : "false"} />
                ))}
              </span>
              <span className={styles.level} aria-label={`${part.level} of 5`}>{part.level}</span>
              <svg className={styles.chev} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 6l4 4 4-4" />
              </svg>
            </summary>
            <div className={styles.partBody}>
              <div>
                <span className={`${styles.caps} ${styles.wellHead}`}>What went well</span>
                {part.wins.length > 0 ? (
                  <ul className={styles.checks}>
                    {part.wins.map((c) => (
                      <li key={c.id} className={styles.check}>
                        <Tick />
                        <span className={styles.checkText}>
                          {c.text}
                          {c.moment ? <span className={styles.moment}>&ldquo;{c.moment}&rdquo;</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.small}>This part is where the next step starts.</p>
                )}
              </div>
              <div>
                <span className={`${styles.caps} ${styles.betterHead}`}>To do it even better</span>
                {part.better.length > 0 ? (
                  <ul className={styles.checks}>
                    {part.better.map((c) => (
                      <li key={c.id} className={styles.check}>
                        <Step />
                        <span className={styles.checkText}>{c.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.keep}>Keep it up. Every check for this part was met.</p>
                )}
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  ) : (
    <section className={`${styles.card} ${styles.section}`} aria-label="How the meeting was run">
      <p className={styles.overview}>
        This meeting was analysed before the facilitation rubric, so there is no part-by-part breakdown.
        {score ? ` Its score at the time was ${scoreText(score)} out of 10.` : ""}
      </p>
    </section>
  );

  // ---- Commitments tab --------------------------------------------
  const commitmentsTab = (
    <div>
      {props.commitmentsTab}
      {props.priorCommitments.length > 0 ? (
        <section className={`${styles.card} ${styles.prior}`} aria-labelledby="prior">
          <div className={styles.talkRow}>
            <h2 id="prior" className={styles.h3}>Last week&apos;s commitments</h2>
            <span className={styles.muted}>
              {priorDone} of {props.priorCommitments.length} done
            </span>
          </div>
          {props.priorCommitments.map((c) => (
            <div key={c.id} className={styles.priorRow}>
              <span className={styles.grow} style={{ flexBasis: 260 }}>{c.description}</span>
              {c.owner ? <span className={styles.muted}>{c.owner}</span> : null}
              <span className={styles.state} data-state={c.state}>
                {c.state === "done" ? "Done" : c.state === "not_done" ? "Not done" : "Still open"}
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );

  // ---- Transcript tab ---------------------------------------------
  const transcriptTab = (
    <section className={`${styles.card} ${styles.transcript}`} aria-label="Transcript">
      {props.transcript.length === 0 ? (
        <p className={styles.muted}>This meeting has no transcript.</p>
      ) : (
        props.transcript.map((t, i) => (
          <p key={i} style={{ margin: 0 }}>
            {t.speaker ? <span className={styles.speaker}>{t.speaker} </span> : null}
            {t.words}
          </p>
        ))
      )}
    </section>
  );

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Meeting">
        <Link href="/leadership" className={styles.crumb}>
          Meeting Summaries
        </Link>
        <p className={styles.eyebrow}>Weekly leadership meeting</p>
        <h1 className={styles.h1}>{props.title}</h1>
        <span className={styles.rule} aria-hidden="true" />
        <div className={styles.meta}>
          <span>{props.dateLabel}</span>
          {props.attendeeCount > 0 ? <span>{props.attendeeCount} attended</span> : null}
        </div>
      </section>

      <div className={styles.body}>
        <div className={`${styles.top} ${props.video ? styles.topWithVideo : ""}`}>
          {props.video ? (
            <section className={`${styles.card} ${styles.videoCard}`} aria-label="Meeting score video">
              <div className={styles.videoFrame}>
                <RecapPlayer src={props.video.embedUrl} poster={props.video.poster} />
              </div>
            </section>
          ) : null}
          <section className={`${styles.card} ${styles.scoreCard}`} aria-labelledby="score">
            <div className={styles.scoreHead}>
              <div>
                <h2 id="score" className={styles.caps}>Meeting score</h2>
                {score ? (
                  <>
                    <div className={styles.scoreLine}>
                      <span className={styles.scoreNumber}>{scoreText(score)}</span>
                      <span className={styles.scoreDenom}>/ 10</span>
                    </div>
                    {/* The total out of 50 was taken off the card (Jason,
                        2026-11-27); the parts below say where it came from. */}
                    {rubric ? null : <div className={styles.scoreNote}>Scored before the facilitation rubric</div>}
                  </>
                ) : (
                  <div className={styles.scoreNote}>{props.banner ? "Scoring when the analysis finishes." : "No score for this meeting."}</div>
                )}
              </div>
              {delta ? (
                <span className={styles.delta} data-up={delta.up ? "true" : "false"}>
                  {delta.text}
                </span>
              ) : null}
            </div>
            {rubric ? (
              <>
                {/* Each part named, with its level as dots, as on How it was
                    run. Numbered bars meant nothing without the breakdown
                    open (Jason, 2026-11-27). */}
                <ul className={styles.partList} aria-label="Score for each part of the meeting">
                  {rubric.parts.map((p, row) => (
                    <li key={p.key} className={styles.partItem}>
                      <span className={styles.partShort}>{PART_SHORT[p.key]}</span>
                      <span className={styles.gauge} aria-hidden="true">
                        {/* Fills one segment at a time up to the level, each row
                            a beat after the one before (--i, --row: the delay).
                            data-n sets the segment's shade, sky to navy. */}
                        {[1, 2, 3, 4, 5].map((n) => (
                          <span
                            key={n}
                            className={styles.seg}
                            data-n={n}
                            data-on={n <= p.level ? "true" : "false"}
                            style={{ "--i": n - 1, "--row": row } as React.CSSProperties}
                          />
                        ))}
                      </span>
                      <span className={styles.partLevel} data-top={p.level === 5 ? "true" : "false"}>
                        {p.level}
                        <span className={styles.srOnly}> of 5, {p.name}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <a className={styles.pillLink} href="#how-it-was-run">
                  See what earned each score
                </a>
              </>
            ) : null}
          </section>

          {next ? (
            <section className={`${styles.card} ${styles.tryCard}`} aria-labelledby="try">
              <h2 id="try" className={styles.caps}>Try this next week</h2>
              <p className={styles.tryTitle}>{next.step}</p>
              <span className={styles.accent} aria-hidden="true" />
              <p className={styles.tryBody}>One step for {next.part}, the part with the most room to grow this week.</p>
            </section>
          ) : (
            <section className={`${styles.card} ${styles.tryCard}`} aria-labelledby="try">
              <h2 id="try" className={styles.caps}>At a glance</h2>
              <p className={styles.tryBody}>{summary?.overview ?? "The summary, commitments and transcript are in the tabs below."}</p>
            </section>
          )}
        </div>

        <div className={styles.glance}>
          {glance.map((g) => (
            <div key={g.label} className={`${styles.card} ${styles.glanceItem}`}>
              <span className={styles.glanceValue}>{g.value}</span>
              <span className={styles.glanceLabel}>{g.label}</span>
            </div>
          ))}
        </div>

        {props.banner}

        <AnalysisTabs
          label="Meeting"
          tabs={[
            { hash: "summary", label: "Summary", content: summaryTab },
            { hash: "how-it-was-run", label: "How it was run", content: runTab },
            { hash: "commitments", label: "Commitments", content: commitmentsTab },
            { hash: "transcript", label: "Transcript", content: transcriptTab },
          ]}
        />

        {props.footer}
      </div>
    </div>
  );
}
