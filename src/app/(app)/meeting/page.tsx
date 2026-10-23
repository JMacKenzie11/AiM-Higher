import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getAssignablePeople } from "@/lib/people/assignable";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { todayInTimezone, formatWeekBeginning, thisFriday, addDays } from "@/lib/dates";
import { simplifyOn } from "@/lib/ui/simplify";
import { headlineAreas } from "@/lib/meeting/areas";
import { PageShell } from "@/components/ui/PageShell";
import { HeadlineField } from "./HeadlineField";
import { Attendance } from "./Attendance";
import commitmentStyles from "../commitments/commitments.module.css";
import issueStyles from "../issues/issues.module.css";
import { MEETING_STEPS, checkInQuestions, stepAfter, stepBefore, type MeetingStep } from "./steps";
import { MeetingTimer } from "./MeetingTimer";
import { MeasuresView, loadMeasuresView } from "../measures/MeasuresView";
import { PlanView } from "../plan/PlanView";
import { CommitmentsView, commitmentFiltersFrom } from "../commitments/CommitmentsView";
import { IssuesView } from "../issues/IssuesView";
import { CheckInNotes } from "./CheckInNotes";
import type { NotesDoc } from "@/components/tiptap/NotesEditor";
import styles from "./meeting.module.css";

// MEETING MODE (simplification review, change 5, the "meeting-mode"
// switch).
//
// The weekly leadership meeting in one view, walked in the order Jeff
// runs it (all-hands, 2026-10-19; steps.ts): a positive check-in,
// each functional area's headlines, the numbers, the quarter's
// strategy, everyone's commitments, then solving the issues together,
// and a close. Running it used to mean five pages (Week in Review,
// Critical Success Factors, Goals & Priorities, Issues, Commitments),
// each with its own header, counters and filters.
//
// EACH STEP IS ONE CARD, the same card the Commitments and Issues
// pages use (a tinted header with the title, the step's main action
// top right of it), with Back and Next inside it at the foot (Jason,
// 2026-10-19: same type and style as every other card, and no
// buttons left floating off a card). Ordinary type sizes. Numbers,
// Strategy, Commitments and Solve are the exception: each is its whole
// page (Jason, 2026-10-23), with Back and Next on a card under it.
//
// Every step acts with the same rows, drawers and views the rest of
// the app uses, so no right is new: marking a commitment kept,
// opening an issue or logging a number is exactly what it is on its
// own page. The things written here and nowhere else are a functional
// area's headline for the week (meeting_headlines, 0288), who is here
// (meeting_attendance, 0290) and the check-in notes (meeting_checkins,
// 0299).
//
// `started` (in the URL, set when the meeting opens) is what the close
// counts from: what was kept, added and resolved since. No table is
// written to say a meeting happened.

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function pick(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function MeetingPage({ searchParams }: PageProps) {
  if (!simplifyOn("meeting-mode")) notFound();
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const sp = await searchParams;
  const started = pick(sp.started);
  const stepParam = pick(sp.step);
  const step: MeetingStep = MEETING_STEPS.some((s) => s.key === stepParam) ? (stepParam as MeetingStep) : "checkin";
  // A meeting starts when the page is opened; the time rides in the
  // URL so a reload or a step change keeps it.
  if (!started || Number.isNaN(Date.parse(started))) {
    redirect(`/meeting?step=${step}&started=${encodeURIComponent(new Date().toISOString())}`);
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: company } = await supabase
    .from("companies")
    .select("name, timezone")
    .eq("id", companyId)
    .maybeSingle<{ name: string; timezone: string }>();
  const timezone = company?.timezone ?? "America/Anchorage";
  const { iso: todayIso } = todayInTimezone(timezone);
  const isAdmin = isAdminForCompany(session.profile, companyId);

  const href = (s: MeetingStep) => `/meeting?step=${s}&started=${encodeURIComponent(started)}`;
  // This step, for a page opened from it to come back to.
  const here = href(step);
  const index = MEETING_STEPS.findIndex((s) => s.key === step);
  const prev = stepBefore(step);
  const next = stepAfter(step);

  // Back and Next, the foot of every step's card.
  const footer = (
    <>
      {prev ? (
        <Link href={href(prev)} className={styles.navButton}>
          Back
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={href(next)} className={styles.navButton}>
          Next: {MEETING_STEPS.find((s) => s.key === next)!.label}
        </Link>
      ) : (
        <Link href="/dashboard" className={styles.navButton}>
          End the meeting
        </Link>
      )}
    </>
  );

  return (
    <PageShell
      eyebrow="Weekly meeting"
      title={company?.name ?? "Weekly meeting"}
      subtitle={MEETING_STEPS[index].lead}
      heroExtras={
        <div className={styles.heroBar}>
          <nav className={styles.steps} aria-label="Meeting agenda">
            {MEETING_STEPS.map((s, i) => (
              <Link
                key={s.key}
                href={href(s.key)}
                className={styles.step}
                aria-current={s.key === step ? "step" : undefined}
                data-done={i < index ? "true" : undefined}
              >
                {s.label}
              </Link>
            ))}
          </nav>
          <MeetingTimer started={started} />
        </div>
      }
    >
      {step === "checkin" ? (
        <CheckIn
          companyId={companyId}
          todayIso={todayIso}
          timezone={timezone}
          canMark={session.profile.company_id === companyId || isAdmin}
          footer={footer}
        />
      ) : null}
      {step === "headlines" ? <Headlines companyId={companyId} timezone={timezone} footer={footer} /> : null}
      {step === "numbers" ? (
        <>
          <MeasuresView data={await loadMeasuresView(session, companyId)} />
          <StepNav footer={footer} />
        </>
      ) : null}
      {step === "strategy" ? (
        <>
          <PlanView session={session} companyId={companyId} q={pick(sp.q)} from={here} />
          <StepNav footer={footer} />
        </>
      ) : null}
      {step === "commitments" ? (
        <>
          <CommitmentsView session={session} companyId={companyId} filters={commitmentFiltersFrom(sp)} />
          <StepNav footer={footer} />
        </>
      ) : null}
      {step === "solve" ? (
        <>
          <IssuesView session={session} companyId={companyId} searchParams={sp} />
          <StepNav footer={footer} />
        </>
      ) : null}
      {step === "close" ? <Close companyId={companyId} started={started} timezone={timezone} footer={footer} /> : null}
    </PageShell>
  );
}

// ---- The card every step sits in ---------------------------------
//
// The Commitments and Issues pages' card: a tinted header with the
// title, a count beside it, and the main action top right; then the
// step's content; then Back and Next.
function StepCard({
  id,
  title,
  meta,
  action,
  footer,
  children,
}: {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={commitmentStyles.group} aria-labelledby={id}>
      <div className={commitmentStyles.groupHeader}>
        <h2 id={id} className={commitmentStyles.groupTitle}>
          {title}
        </h2>
        {meta !== undefined && meta !== null ? <span className={commitmentStyles.groupMeta}>{meta}</span> : null}
        {action ? <span className={issueStyles.headerAdd}>{action}</span> : null}
      </div>
      {children}
      <div className={styles.cardFooter}>{footer}</div>
    </section>
  );
}

// ---- 1. Check-in -------------------------------------------------
//
// First, who is in the room: a tick beside each person on the roster
// (Jason, 2026-10-19; meeting_attendance, 0290). Then a positive
// check-in, as Jeff runs it: two open, generic questions to go round
// the room (steps.ts, a different pair each week), and one rich text
// page where the answers are written down as people give them
// (Jason, 2026-10-23; meeting_checkins, 0299). Not questions drawn
// from last meeting's analysis: those are about the work, and this is
// about the people.
async function CheckIn({
  companyId,
  todayIso,
  timezone,
  canMark,
  footer,
}: {
  companyId: string;
  todayIso: string;
  timezone: string;
  canMark: boolean;
  footer: ReactNode;
}) {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const week = thisFriday(timezone);
  const [roster, marked, notes] = await Promise.all([
    getAssignablePeople(supabase, companyId),
    supabase.from("meeting_attendance").select("profile_id").eq("company_id", companyId).eq("week_ending", week),
    supabase
      .from("meeting_checkins")
      .select("body")
      .eq("company_id", companyId)
      .eq("week_ending", week)
      .maybeSingle<{ body: NotesDoc }>(),
  ]);
  const present = ((marked.data ?? []) as Array<{ profile_id: string }>).map((r) => r.profile_id);

  return (
    <StepCard id="meeting-checkin" title="Check-in" footer={footer}>
      <h3 className={`${styles.subhead} ${styles.subheadFirst}`}>Who&rsquo;s here</h3>
      <div className={styles.cardBody}>
        <Attendance
          people={roster.map((p) => ({ id: p.id, full_name: p.full_name }))}
          initialPresent={present}
          canMark={canMark}
        />
      </div>
      <h3 className={styles.subhead}>Suggested positive check-in questions</h3>
      <div className={styles.cardBody}>
        <ol className={styles.questionList}>
          {checkInQuestions(todayIso).map((q) => (
            <li key={q} className={styles.question}>
              {q}
            </li>
          ))}
        </ol>
      </div>
      <h3 className={styles.subhead}>Check-in notes</h3>
      <CheckInNotes weekEnding={week} initial={notes.data?.body ?? null} canWrite={canMark} />
    </StepCard>
  );
}

// ---- 2. Headlines ------------------------------------------------
//
// Each functional area's update, as Jeff runs it: what happened last
// week, what worked, what is coming, what the area needs support on.
// Not its commitments or its numbers, which have their own steps.
// One row per function, last week's headline read beside this week's,
// which is written in the room and saves as the field is left. The
// week is the one now running, by the Friday it ends on.
async function Headlines({ companyId, timezone, footer }: { companyId: string; timezone: string; footer: ReactNode }) {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const week = thisFriday(timezone);
  const lastWeek = addDays(week, -7);
  const [functions, headlines, people] = await Promise.all([
    supabase
      .from("functions")
      .select("id, title, lead_id, parent_function_id")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("sort_order")
      .order("title"),
    supabase
      .from("meeting_headlines")
      .select(simplifyOn("transcript-headlines") ? "function_id, week_ending, body, source_meeting_id" : "function_id, week_ending, body")
      .eq("company_id", companyId)
      .in("week_ending", [week, lastWeek]),
    getAssignablePeople(supabase, companyId),
  ]);
  type Fn = { id: string; title: string; lead_id: string | null; parent_function_id: string | null };
  // The functional areas only: the leadership seats (the Visionary and
  // Integrator, whatever they are called) give no headline
  // (meeting/areas.ts; Jason, 2026-10-20).
  const rows = headlineAreas((functions.data ?? []) as Fn[]);
  type Headline = { function_id: string; week_ending: string; body: string; source_meeting_id?: string | null };
  const byKey = new Map(
    ((headlines.data ?? []) as unknown as Headline[]).map((h) => [`${h.function_id}:${h.week_ending}`, h])
  );
  // Under the "transcript-headlines" switch, a headline the meeting's
  // transcript filled in says so, until someone edits it (0292).
  const fromTranscript = (h: Headline | undefined) => Boolean(h?.source_meeting_id);
  const names = new Map(people.map((p) => [p.id, p.full_name]));
  const leadName = (f: Fn) => (f.lead_id ? names.get(f.lead_id) ?? null : null);

  return (
    <StepCard id="meeting-headlines" title="Headlines, for this past week" meta={rows.length > 0 ? `${rows.length} functional areas` : null} footer={footer}>
      {rows.length === 0 ? (
        <p className={styles.mutedPad}>
          No functional areas yet. <Link href="/chart">Add them on the Functional Chart</Link>.
        </p>
      ) : (
        rows.map((f, i) => {
          const lastRow = byKey.get(`${f.id}:${lastWeek}`);
          const nowRow = byKey.get(`${f.id}:${week}`);
          const last = lastRow?.body.trim() ?? "";
          const now = nowRow?.body ?? "";
          const lead = leadName(f);
          return (
            <section key={f.id} aria-label={`${f.title} headlines`}>
              <h3 className={`${styles.subhead} ${i === 0 ? styles.subheadFirst : ""}`}>
                {f.title}
                {lead ? <span className={styles.subheadMeta}>{lead}</span> : null}
              </h3>
              <div className={`${styles.headlineGrid} ${styles.headlineRow}`}>
                <div className={styles.headlineCol}>
                  <h4>Last week, {formatWeekBeginning(lastWeek)}</h4>
                  {last ? <p className={styles.headlineLast}>{last}</p> : <p className={styles.muted}>Nothing written.</p>}
                  {last && fromTranscript(lastRow) ? <p className={styles.headlineSource}>From the meeting&rsquo;s transcript.</p> : null}
                </div>
                <div className={styles.headlineCol}>
                  <h4>This week, {formatWeekBeginning(week)}</h4>
                  <HeadlineField
                    functionId={f.id}
                    functionTitle={f.title}
                    weekEnding={week}
                    initial={now}
                    fromTranscript={now.trim() !== "" && fromTranscript(nowRow)}
                  />
                </div>
              </div>
            </section>
          );
        })
      )}
    </StepCard>
  );
}

// ---- 3 to 6. The pages themselves ---------------------------------
//
// Numbers, Strategy, Commitments and Solve are the Critical Success
// Factors, Goals & Priorities, Functional Commitments and
// Issues/Solutions pages, whole (Jason, 2026-10-23: everything those
// pages do, without leaving the meeting). Each renders the page's own
// view, the one its page renders under its header, so the two cannot
// drift apart: filters, closed and resolved work, adds and edits are
// the page's. Back and Next sit on a card of their own under it.
// Strategy's links to a priority, goal or focus area carry the meeting
// with them, and the page they open offers the way back.
function StepNav({ footer }: { footer: ReactNode }) {
  return (
    <nav className={commitmentStyles.group} aria-label="Meeting steps">
      <div className={`${styles.cardFooter} ${styles.cardFooterAlone}`}>{footer}</div>
    </nav>
  );
}

// ---- 7. Close ----------------------------------------------------
//
// Jeff's reminder, then what changed while the meeting ran, counted
// from `started`.
async function Close({
  companyId,
  started,
  timezone,
  footer,
}: {
  companyId: string;
  started: string;
  timezone: string;
  footer: ReactNode;
}) {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [here, kept, added, resolved, raised] = await Promise.all([
    count(
      supabase
        .from("meeting_attendance")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("week_ending", thisFriday(timezone))
    ),
    count(
      supabase
        .from("commitments")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .in("status", ["kept_on_time", "kept_late"])
        .gte("completed_at", started)
        .is("deleted_at", null)
    ),
    count(supabase.from("commitments").select("id", { count: "exact", head: true }).eq("company_id", companyId).gte("created_at", started).is("deleted_at", null)),
    count(supabase.from("issues").select("id", { count: "exact", head: true }).eq("company_id", companyId).gte("resolved_at", started)),
    count(supabase.from("issues").select("id", { count: "exact", head: true }).eq("company_id", companyId).gte("created_at", started)),
  ]);
  const line = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <StepCard id="meeting-close" title="In this meeting" footer={footer}>
      <div className={styles.cardBody}>
        <p className={styles.closeLine}>
          Your commitments are in the system. Mark each one complete as you go, before next week.
        </p>
      </div>
      <ul className={styles.plainList}>
        <li>{line(here, "person here", "people here")}</li>
        <li>{line(kept, "commitment kept", "commitments kept")}</li>
        <li>{line(added, "new commitment", "new commitments")}</li>
        <li>{line(resolved, "issue resolved", "issues resolved")}</li>
        <li>{line(raised, "issue raised", "issues raised")}</li>
      </ul>
      <p className={styles.mutedPad}>
        A transcript of the meeting, once it&rsquo;s analysed, shows on <Link href="/leadership">Meeting Summaries</Link>.
      </p>
    </StepCard>
  );
}
