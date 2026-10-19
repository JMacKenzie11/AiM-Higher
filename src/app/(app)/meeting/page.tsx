import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { canOwnWorkIn, canWriteOwnedRow, isAdminForCompany } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getAssignablePeople } from "@/lib/people/assignable";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { getCommitmentsPageData } from "@/lib/commitments/service";
import { isNeedsAttention } from "@/lib/commitments/needs-attention";
import { getIssuesPageData } from "@/lib/issues/service";
import { getBoardData } from "@/lib/measures/board";
import { getCascade, type CascadePriority } from "@/lib/plan/service";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { getDashboardData } from "@/lib/dashboard/service";
import { todayInTimezone, formatShortDate, formatWeekBeginning, thisFriday, addDays } from "@/lib/dates";
import { simplifyOn } from "@/lib/ui/simplify";
import type { Priority } from "@/lib/types";
import { PageShell } from "@/components/ui/PageShell";
import { CommitmentRow } from "../commitments/CommitmentRow";
import { InlineAddRow } from "../commitments/InlineAddRow";
import { IssuesBoard } from "../issues/IssuesBoard";
import { AddIssueButton } from "../issues/AddIssueButton";
import { HeadlineField } from "./HeadlineField";
import commitmentStyles from "../commitments/commitments.module.css";
import issueStyles from "../issues/issues.module.css";
import { MEETING_STEPS, stepAfter, stepBefore, type MeetingStep } from "./steps";
import { MeetingTimer } from "./MeetingTimer";
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
// Each step shows only what the room should talk about, and acts with
// the same rows and drawer the rest of the app uses, so no right is
// new: marking a commitment kept, opening an issue or adding a
// commitment is exactly what it is on its own page. The one thing
// written here and nowhere else is a functional area's headline for
// the week (meeting_headlines, 0288).
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
  const index = MEETING_STEPS.findIndex((s) => s.key === step);
  const prev = stepBefore(step);
  const next = stepAfter(step);

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
      <div className={styles.stage}>
        {step === "checkin" ? <CheckIn companyId={companyId} /> : null}
        {step === "headlines" ? <Headlines companyId={companyId} timezone={timezone} /> : null}
        {step === "numbers" ? <Numbers companyId={companyId} timezone={timezone} /> : null}
        {step === "strategy" ? <Strategy companyId={companyId} /> : null}
        {step === "commitments" ? (
          <Commitments companyId={companyId} profile={session.profile} isAdmin={isAdmin} canAdd={canOwnWorkIn(session.profile, companyId)} />
        ) : null}
        {step === "solve" ? (
          <Solve companyId={companyId} todayIso={todayIso} isAdmin={isAdmin} profileId={session.profile.id} canRaise={session.profile.company_id === companyId || isAdmin} />
        ) : null}
        {step === "close" ? <Close companyId={companyId} started={started} /> : null}
      </div>

      <div className={styles.footer}>
        {prev ? (
          <Link href={href(prev)} className={styles.back}>
            Back
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={href(next)} className={styles.next}>
            Next: {MEETING_STEPS.find((s) => s.key === next)!.label}
          </Link>
        ) : (
          <Link href="/dashboard" className={styles.next}>
            End the meeting
          </Link>
        )}
      </div>
    </PageShell>
  );
}

// ---- 1. Check-in -------------------------------------------------
//
// Open on what went well. The question is the first of the "questions
// worth asking next week" the last analysed meeting produced, which
// are generated and checked to be generative (lib/leadership/
// questions.ts); with none, a standing one in the same shape. Then the
// wins of the past week, to have something real to start from.
async function CheckIn({ companyId }: { companyId: string }) {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const [dash, meetings] = await Promise.all([
    getDashboardData(companyId),
    supabase
      .from("meetings")
      .select("id")
      .eq("company_id", companyId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  // The newest of the last few analysed meetings that produced
  // questions: a meeting analysed without the facilitation review has
  // none, and should not hide the one before it that did.
  let question: { question: string; moment: string } | null = null;
  const ids = (meetings.data ?? []).map((m) => m.id);
  if (ids.length > 0) {
    const { data: analyses } = await supabase
      .from("meeting_analyses")
      .select("meeting_id, facilitation_review_json")
      .in("meeting_id", ids);
    const byMeeting = new Map(
      ((analyses ?? []) as Array<{ meeting_id: string; facilitation_review_json: { next_week_questions?: { question: string; moment: string }[] } | null }>).map((a) => [
        a.meeting_id,
        a.facilitation_review_json?.next_week_questions?.[0] ?? null,
      ])
    );
    question = ids.map((id) => byMeeting.get(id) ?? null).find(Boolean) ?? null;
  }
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const wins = (dash?.recentSuccesses ?? []).filter((w) => (w.completedAt ?? "") >= weekAgo);

  return (
    <>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Open with this</h2>
        <p className={styles.question}>
          {question?.question ?? "What went well for you this week, and what made it work?"}
        </p>
        {question?.moment ? <p className={styles.muted}>From last meeting: {question.moment}</p> : null}
      </section>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Kept this week</h2>
        {wins.length > 0 ? (
          <ul className={styles.plainList}>
            {wins.map((w) => (
              <li key={w.id}>
                <span>{w.description}</span>
                <span className={styles.muted}>{w.ownerName}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Nothing kept in the last seven days yet.</p>
        )}
      </section>
    </>
  );
}

// ---- 2. Headlines ------------------------------------------------
//
// Each functional area's update, as Jeff runs it: what happened last
// week, what worked, what is coming, what the area needs support on.
// Not its commitments or its numbers, which have their own steps.
// One block per function, last week's headline read beside this
// week's, which is written in the room and saves as the field is
// left. The week is the one now running, by the Friday it ends on.
async function Headlines({ companyId, timezone }: { companyId: string; timezone: string }) {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const week = thisFriday(timezone);
  const lastWeek = addDays(week, -7);
  const [functions, headlines, people] = await Promise.all([
    supabase
      .from("functions")
      .select("id, title, lead_id")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("sort_order")
      .order("title"),
    supabase
      .from("meeting_headlines")
      .select("function_id, week_ending, body")
      .eq("company_id", companyId)
      .in("week_ending", [week, lastWeek]),
    getAssignablePeople(supabase, companyId),
  ]);
  type Fn = { id: string; title: string; lead_id: string | null };
  const rows = (functions.data ?? []) as Fn[];
  const byKey = new Map(
    ((headlines.data ?? []) as Array<{ function_id: string; week_ending: string; body: string }>).map((h) => [
      `${h.function_id}:${h.week_ending}`,
      h.body,
    ])
  );
  const names = new Map(people.map((p) => [p.id, p.full_name]));
  const leadName = (f: Fn) => (f.lead_id ? names.get(f.lead_id) ?? null : null);

  if (rows.length === 0) {
    return (
      <section className={styles.card}>
        <p className={styles.muted}>
          No functional areas yet. <Link href="/chart">Add them on the Functional Chart</Link>.
        </p>
      </section>
    );
  }

  return (
    <>
      {rows.map((f) => {
        const last = byKey.get(`${f.id}:${lastWeek}`)?.trim() ?? "";
        const now = byKey.get(`${f.id}:${week}`) ?? "";
        const lead = leadName(f);
        return (
          <section key={f.id} className={styles.card} aria-label={`${f.title} headlines`}>
            <h2 className={styles.cardTitle}>
              {f.title}
              {lead ? <span className={styles.muted}> · {lead}</span> : null}
            </h2>
            <div className={styles.headlineGrid}>
              <div className={styles.headlineCol}>
                <h3>Last week, {formatWeekBeginning(lastWeek)}</h3>
                {last ? <p className={styles.headlineLast}>{last}</p> : <p className={styles.muted}>Nothing written.</p>}
              </div>
              <div className={styles.headlineCol}>
                <h3>This week, {formatWeekBeginning(week)}</h3>
                <HeadlineField functionId={f.id} functionTitle={f.title} weekEnding={week} initial={now} />
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}

// ---- 3. Numbers --------------------------------------------------
//
// Only the numbers worth a conversation: off target, or not logged,
// for the week just ended. The rest are counted, not listed.
async function Numbers({ companyId, timezone }: { companyId: string; timezone: string }) {
  const board = await getBoardData(companyId, timezone);
  const week = board.weeks.at(-2) ?? board.weeks.at(-1) ?? null;
  const rows = board.functions.flatMap((f) =>
    f.metrics.map((m) => ({ fn: f, m, cell: week ? m.cells.find((c) => c.weekEnding === week) ?? null : null }))
  );
  // The board says "no target" before it looks for a value, so a
  // measure with no target is logged or not by whether it has one.
  // An empty cell's display value is the board's "—" placeholder.
  const logged = (r: (typeof rows)[number]) =>
    Boolean(r.cell && r.cell.status !== "unlogged" && r.cell.displayValue && r.cell.displayValue !== "—");
  const talk = rows.filter((r) => r.cell?.status === "off" || !logged(r));
  const onTarget = rows.filter((r) => r.cell?.status === "good").length;
  const noTarget = rows.filter((r) => r.cell?.status === "no_target" && logged(r)).length;

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>
        {week ? `Week ending ${formatShortDate(week)}` : "This week's numbers"}
      </h2>
      {rows.length === 0 ? (
        <p className={styles.muted}>
          No critical success factors yet. <Link href="/measures">Add them on Critical Success Factors</Link>.
        </p>
      ) : talk.length === 0 && noTarget === 0 ? (
        <p className={styles.good}>All {rows.length} logged and on target.</p>
      ) : (
        <>
          <ul className={styles.plainList}>
            {talk.map(({ fn, m, cell }) => (
              <li key={m.id}>
                <span>
                  <strong>{m.description}</strong>
                  <span className={styles.muted}> · {fn.title}{fn.seatHolder ? `, ${fn.seatHolder}` : ""}</span>
                </span>
                <span className={cell?.status === "off" ? styles.bad : styles.muted}>
                  {cell?.status === "off" ? `${cell.displayValue} (target ${m.target ?? "not set"})` : "Not logged"}
                </span>
              </li>
            ))}
          </ul>
          {onTarget > 0 || noTarget > 0 ? (
            <p className={styles.muted}>
              {[onTarget > 0 ? `${onTarget} on target` : null, noTarget > 0 ? `${noTarget} logged with no target set` : null]
                .filter(Boolean)
                .join(", ")}
              .
            </p>
          ) : null}
        </>
      )}
      <p className={styles.muted}>
        <Link href="/measures">Log or change numbers on Critical Success Factors</Link>
      </p>
    </section>
  );
}

// ---- 4. Strategy -------------------------------------------------
//
// The quarter's priorities that are not done, behind ones first, with
// who owns each and how much is still open on it.
async function Strategy({ companyId }: { companyId: string }) {
  const quarter = await getCurrentQuarter(companyId);
  const cascade = await getCascade(companyId, quarter?.id ?? null);
  const all: CascadePriority[] = [
    ...cascade.sfas.flatMap((s) => [...s.priorities, ...s.goals.flatMap((g) => g.priorities)]),
    ...cascade.orphanGoals.flatMap((g) => g.priorities),
    ...cascade.orphanPriorities,
  ];
  const order: Record<Priority["status"], number> = { behind: 0, not_started: 1, on_track: 2, ongoing: 3, complete: 4 };
  const live = all.filter((p) => p.status !== "complete").sort((a, b) => order[a.status] - order[b.status]);
  const done = all.length - live.length;
  const label: Record<Priority["status"], string> = { behind: "Behind", not_started: "Not started", on_track: "On track", ongoing: "Ongoing", complete: "Complete" };

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>{quarter ? quarter.label : "This quarter"}</h2>
      {all.length === 0 ? (
        <p className={styles.muted}>
          No priorities this quarter. <Link href="/plan">Add them on Goals &amp; Priorities</Link>.
        </p>
      ) : (
        <>
          <ul className={styles.plainList}>
            {live.map((p) => (
              <li key={p.id}>
                <span>
                  <Link href={`/plan/priority/${p.id}`}>{p.title}</Link>
                  <span className={styles.muted}>
                    {" "}
                    · {p.owner?.full_name ?? "Unassigned"} · {p.open_count} open
                  </span>
                </span>
                <span className={p.status === "behind" ? styles.bad : styles.muted}>{label[p.status]}</span>
              </li>
            ))}
          </ul>
          {done > 0 ? <p className={styles.muted}>{done} complete.</p> : null}
        </>
      )}
    </section>
  );
}

// ---- 6. Solve together -------------------------------------------
//
// Jeff opens this step with one question to each functional area
// (the step's lead line), and the room adds what comes up. The list
// under it is the Issues page's own board, drag handles included, so
// the order the room puts them in is the order /issues shows after,
// and each opens in the drawer where the next commitment is agreed.
async function Solve({
  companyId,
  todayIso,
  isAdmin,
  profileId,
  canRaise,
}: {
  companyId: string;
  todayIso: string;
  isAdmin: boolean;
  profileId: string;
  canRaise: boolean;
}) {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const quarter = await getCurrentQuarter(companyId);
  const [data, roster, priorities, functions] = await Promise.all([
    getIssuesPageData(companyId),
    getAssignablePeople(supabase, companyId),
    quarter
      ? supabase.from("priorities").select("id, title").eq("company_id", companyId).eq("quarter_id", quarter.id).eq("archived", false).order("title")
      : Promise.resolve({ data: [] as Array<{ id: string; title: string }> }),
    supabase.from("functions").select("id, title").eq("company_id", companyId).eq("archived", false).order("title"),
  ]);
  const rosterMin = roster.map((p) => ({ id: p.id, full_name: p.full_name }));
  const priorityOptions = (priorities.data ?? []) as Array<Pick<Priority, "id" | "title">>;
  const functionalAreaOptions = (functions.data ?? []) as Array<{ id: string; title: string }>;

  return (
    <section className={commitmentStyles.group} aria-labelledby="meeting-issues">
      <div className={commitmentStyles.groupHeader}>
        <h2 id="meeting-issues" className={commitmentStyles.groupTitle}>
          Open issues
        </h2>
        <span className={commitmentStyles.groupMeta}>{data.open.length}</span>
        {canRaise ? (
          <span className={issueStyles.headerAdd}>
            <AddIssueButton ctx={{ roster: rosterMin, priorityOptions, functionalAreaOptions, todayIso, currentUserId: profileId, isAdmin }} />
          </span>
        ) : null}
      </div>
      {data.open.length > 0 ? (
        <IssuesBoard
          issues={data.open}
          roster={rosterMin}
          priorityOptions={priorityOptions}
          functionalAreaOptions={functionalAreaOptions}
          todayIso={todayIso}
          currentUserId={profileId}
          isAdmin={isAdmin}
        />
      ) : (
        <p className={styles.mutedPad}>No open issues. Add one if something is in the way.</p>
      )}
    </section>
  );
}

// ---- 5. Commitments ----------------------------------------------
//
// What is due this week and what is late, grouped by person, so each
// person can say kept or not in turn. New ones are added at the top.
async function Commitments({
  companyId,
  profile,
  isAdmin,
  canAdd,
}: {
  companyId: string;
  profile: Awaited<ReturnType<typeof requireProfile>>["profile"];
  isAdmin: boolean;
  canAdd: boolean;
}) {
  const data = await getCommitmentsPageData(companyId, profile.id, { owner: "all", status: "open", type: "all" });
  const open = data.mainList.filter((c) => c.status === "open");
  const roster = data.roster.map((p) => ({ id: p.id, full_name: p.full_name }));
  const byOwner = new Map<string, typeof open>();
  for (const c of open) {
    const key = c.owner?.full_name ?? "Unassigned";
    byOwner.set(key, [...(byOwner.get(key) ?? []), c]);
  }
  const people = [...byOwner.entries()].sort(([a], [b]) => (a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)));

  return (
    <>
      {canAdd ? (
        <section className={`${commitmentStyles.group} ${commitmentStyles.addFirst}`} aria-label="Add a commitment">
          <InlineAddRow
            thisFriday={data.thisFriday}
            priorityOptions={data.priorityOptions}
            functionalAreaOptions={data.functionalAreaOptions}
            roster={roster}
            currentUserId={profile.id}
            isAdmin={isAdmin}
          />
        </section>
      ) : null}
      {people.length === 0 ? (
        <section className={styles.card}>
          <p className={styles.muted}>Nothing open this week.</p>
        </section>
      ) : (
        people.map(([name, rows]) => {
          const late = rows.filter((c) => isNeedsAttention(c, data.thisFriday)).length;
          return (
            <section key={name} className={commitmentStyles.group} aria-label={name}>
              <div className={commitmentStyles.groupHeader}>
                <h2 className={commitmentStyles.groupTitle}>{name}</h2>
                <span className={commitmentStyles.groupMeta}>
                  {rows.length} open{late > 0 ? `, ${late} past due` : ""}
                </span>
              </div>
              <ul className={`${commitmentStyles.rowList} ${styles.ownedList}`}>
                {rows.map((c) => (
                  <CommitmentRow
                    key={c.id}
                    commitment={c}
                    priorityOptions={data.priorityOptions}
                    functionalAreaOptions={data.functionalAreaOptions}
                    roster={roster}
                    todayIso={data.todayIso}
                    canResolve={canWriteOwnedRow(profile, c)}
                    canLink={canWriteOwnedRow(profile, c)}
                    canReassign={canWriteOwnedRow(profile, c)}
                    currentUserId={profile.id}
                    isAdmin={isAdmin}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}

// ---- Close -------------------------------------------------------
//
// What changed while the meeting ran, counted from `started`.
async function Close({ companyId, started }: { companyId: string; started: string }) {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [kept, added, resolved, raised] = await Promise.all([
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
    <section className={styles.card}>
      <p className={styles.closeLine}>
        Your commitments are in the system. Mark each one complete as you go, before next week.
      </p>
      <h2 className={styles.cardTitle}>In this meeting</h2>
      <ul className={styles.tally}>
        <li>{line(kept, "commitment kept", "commitments kept")}</li>
        <li>{line(added, "new commitment", "new commitments")}</li>
        <li>{line(resolved, "issue resolved", "issues resolved")}</li>
        <li>{line(raised, "issue raised", "issues raised")}</li>
      </ul>
      <p className={styles.muted}>
        A transcript of the meeting, once it&rsquo;s analysed, shows on <Link href="/leadership">Meeting Summaries</Link>.
      </p>
    </section>
  );
}
