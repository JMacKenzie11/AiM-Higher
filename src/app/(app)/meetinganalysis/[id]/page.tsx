import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { FacilitationReview } from "@/components/leadership/FacilitationReview";
import { computeOverall } from "@/lib/leadership/facilitation/score";
import { commitmentQuality } from "@/lib/lead-analysis/context";
import type { LeadAnalysisRow } from "@/lib/lead-analysis/types";
import { StatusChip } from "../StatusChip";
import { AutoRefresh } from "./AutoRefresh";
import { RetryButton } from "./RetryButton";
import styles from "../../admin/companies/admin.module.css";
import lead from "../lead.module.css";

// One lead analysis: who it is for, where it stands, the PDF, and the
// analysis on screen to review before the call. System admins only.
export const maxDuration = 300;

export default async function LeadAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["system_admin"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: row } = await supabase
    .from("lead_meeting_analyses")
    .select("*")
    .eq("id", id)
    .maybeSingle<LeadAnalysisRow>();
  if (!row) notFound();

  const running = row.status === "pending" || row.status === "analyzing";
  const review = row.facilitation_review_json;
  const overall = computeOverall({
    positive_framing: row.score_positive_framing,
    accountability: row.score_accountability,
    rhythm: row.score_rhythm,
    alignment: row.score_alignment,
    agenda: row.score_agenda,
  });
  const quality = commitmentQuality(row.commitments_json);

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Meeting analysis">
        <div className={styles.heroInner}>
          <Link href="/meetinganalysis" className={styles.crumbLink}>
            {"←"} All analyses
          </Link>
          <p className={styles.eyebrow}>Free meeting analysis</p>
          <h1 className={styles.h1}>
            Prepared for {row.full_name}, {row.company_name}
          </h1>
          <span className={styles.rule} aria-hidden="true" />
        </div>
      </section>

      <div className={styles.content}>
        {running ? <AutoRefresh /> : null}

        <section className={styles.card} aria-labelledby="details">
          <h2 id="details" className={styles.h2}>
            Details
          </h2>
          <dl className={lead.facts}>
            <div>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${row.email}`}>{row.email}</a>
              </dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{row.role_title ?? "–"}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>
                {new Date(row.created_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusChip status={row.status} />
              </dd>
            </div>
            {overall ? (
              <div>
                <dt>Facilitation score</dt>
                <dd>{overall.oneDecimal} / 10</dd>
              </div>
            ) : null}
            {quality.total > 0 ? (
              <div>
                <dt>Clear commitments</dt>
                <dd>
                  {quality.clear} of {quality.total}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className={lead.actions} style={{ marginTop: "var(--space-5)" }}>
            {row.status === "complete" ? (
              <>
                <a href={`/meetinganalysis/${row.id}/pdf`} className={styles.primaryButton}>
                  Download PDF
                </a>
                <a
                  href={`/meetinganalysis/${row.id}/pdf?view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.ghostButton}
                >
                  Open PDF
                </a>
              </>
            ) : null}
            {row.status === "failed" ? <RetryButton id={row.id} /> : null}
          </div>
          {running ? (
            <p className={styles.fieldHint} role="status">
              Analyzing the transcript. This takes two to four minutes, and the page updates when it is done.
            </p>
          ) : null}
          {row.status === "failed" ? (
            <p className={styles.errorMessage}>
              The analysis didn&apos;t finish{row.error ? `: ${row.error}` : "."}
            </p>
          ) : null}
        </section>

        {row.status === "complete" ? (
          <>
            {review ? (
              <FacilitationReview
                review={review}
                score={overall ? { kind: "computed", score: overall, value: overall.hundredths / 100 } : null}
              />
            ) : null}

            <section className={styles.card} aria-labelledby="commitments">
              <h2 id="commitments" className={styles.h2}>
                Commitment quality
              </h2>
              {row.commitments_json.length === 0 ? (
                <p className={styles.emptyLine}>No commitments came out of this meeting.</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {row.commitments_json.map((c, i) => (
                    <li key={i} className={lead.commitment}>
                      <div className={lead.commitmentText}>{c.description}</div>
                      <div className={styles.mutedCell}>
                        {c.owner ?? "No owner named"}
                        {c.due_phrase ? ` · ${c.due_phrase}` : ""}
                      </div>
                      <div className={lead.checks}>
                        <span className={c.clarity_timeline ? styles.chipActive : styles.chipPending}>
                          {c.clarity_timeline ? "Deadline" : "No clear deadline"}
                        </span>
                        <span className={c.clarity_success ? styles.chipActive : styles.chipPending}>
                          {c.clarity_success ? "Done is defined" : "Done is not defined"}
                        </span>
                      </div>
                      {c.clarity_note ? <p className={lead.rewrite}>{c.clarity_note}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {row.issues_json.length > 0 ? (
              <section className={styles.card} aria-labelledby="issues">
                <h2 id="issues" className={styles.h2}>
                  Left open
                </h2>
                <ul>
                  {row.issues_json.map((iss, i) => (
                    <li key={i}>{iss.title}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className={styles.card} aria-labelledby="analysis">
              <h2 id="analysis" className={styles.h2}>
                Meeting Analysis
              </h2>
              {row.truncated ? (
                <p className={styles.emptyLine} role="status">
                  This summary was cut short before it finished.
                </p>
              ) : null}
              <div className="aims-prose">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.analysis_markdown ?? ""}</ReactMarkdown>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
