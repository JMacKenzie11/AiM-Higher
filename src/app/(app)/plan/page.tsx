import Link from "next/link";
import { MobileAddMenu } from "./MobileAddMenu";
import { PlanAddDrawers } from "./PlanAddDrawers";
import { PlusIcon } from "../../../components/ui/PlusIcon";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getCascade } from "@/lib/plan/service";
import { getQuartersForCompany } from "@/lib/quarters/service";
import { StatusChip } from "@/components/plan/StatusChip";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { QuarterSwitcher } from "./QuarterSwitcher";
import { AddGoalForm } from "./AddGoalForm";
import { AddPriorityForm } from "./AddPriorityForm";
import { LinkGoalToSfaSelect } from "./LinkGoalToSfaSelect";
import { LinkPriorityToParentSelect } from "./LinkPriorityToParentSelect";
import { CascadePriorityRow } from "./CascadePriorityRow";
import { formatParentRef, NO_PARENT } from "@/lib/plan/parent-ref";
import { PlanCascadeController } from "./PlanCascadeController";
import { goalAnchorId, sfaAnchorId } from "./cascade-anchor";
import { PageShell } from "@/components/ui/PageShell";
import styles from "./plan.module.css";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { thisFriday } from "@/lib/dates";

// Plan workspace — Section 8.3.

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

// What is still to do under a priority, not how much has ever been
// attached to it.
//
// This read "N commitments" and counted kept + open + missed, so a
// finished priority said "3 commitments" forever and a live one gave
// no sense of what was outstanding. The progress bar beside it
// already says how much is done; the meta line is the better place
// for what is left.
//
// The word "open" is load-bearing. "1 commitment" beside a bar
// reading 50% looks like one of the two numbers is wrong, and only
// the label tells you they are answering different questions.
export default async function PlanPage({ searchParams }: PageProps) {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const { q } = await searchParams;

  const quarters = await getQuartersForCompany(companyId);
  const openQuarter = quarters.find((quarter) => quarter.status === "open");
  const selectedQuarter =
    (q && quarters.find((quarter) => quarter.id === q)) ||
    openQuarter ||
    quarters[0] ||
    null;

  const cascade = await getCascade(
    companyId,
    selectedQuarter ? selectedQuarter.id : null
  );

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("company_id", companyId)
    .order("full_name");
  const roster = (people ?? []) as Pick<Profile, "id" | "full_name">[];

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";

  // Every priority in the selected quarter, labelled by what it sits
  // under, for the Add Commitment picker. Two priorities can share a
  // title under different parents, and "Sign the lease" twice in a
  // row is not a choice anybody can make.
  const priorityChoices = [
    ...cascade.sfas.flatMap((sfa) => [
      ...sfa.goals.flatMap((goal) =>
        goal.priorities.map((p) => ({
          id: p.id,
          title: p.title,
          parentLabel: `${sfa.title} › ${goal.title}`,
        }))
      ),
      ...sfa.priorities.map((p) => ({
        id: p.id,
        title: p.title,
        parentLabel: sfa.title,
      })),
    ]),
    ...cascade.orphanGoals.flatMap((goal) =>
      goal.priorities.map((p) => ({
        id: p.id,
        title: p.title,
        parentLabel: goal.title,
      }))
    ),
    ...cascade.orphanPriorities.map((p) => ({
      id: p.id,
      title: p.title,
      parentLabel: "Standalone",
    })),
  ];

  // This Friday in the COMPANY's timezone, not the reader's laptop's.
  const { data: companyRow } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string | null }>();
  const defaultDueDate = thisFriday(companyRow?.timezone ?? "America/Anchorage");

  const sfaOptions = cascade.sfas.map((sfa) => ({ id: sfa.id, title: sfa.title }));
  const goalOptions = [
    ...cascade.sfas.flatMap((sfa) =>
      sfa.goals.map((g) => ({ id: g.id, title: g.title }))
    ),
    ...cascade.orphanGoals.map((g) => ({ id: g.id, title: g.title })),
  ];

  return (
    <PageShell
      eyebrow="Company"
      title="Goals & Priorities"
      subtitle="The cascade for your company, one quarter at a time."
    >
      {/* Toolbar is always visible. SFAs and goals aren't
          quarter-scoped, so the operator can populate the top of the
          cascade before opening a quarter. Only priorities need a
          quarter, and that gating happens at the priority form. */}
      <div className={styles.toolbar}>
        {quarters.length > 0 ? (
          <QuarterSwitcher
            quarters={quarters.map((quarter) => ({
              id: quarter.id,
              label: quarter.label,
              status: quarter.status,
            }))}
            selectedId={selectedQuarter?.id ?? null}
          />
        ) : (
          <span className={styles.toolbarMuted}>
            No quarters yet — open one to add priorities.
          </span>
        )}
        {isAdmin ? (
          <MobileAddMenu>
            {!openQuarter ? (
              <Link href="/quarters" className={styles.toolbarGhost}>
                + {quarters.length === 0 ? "Open your first quarter" : "Open next quarter"}
              </Link>
            ) : null}
            {/* The four add buttons, and the one drawer they share.
                They were four <details> with floating panels; the
                drawer gives the dismissals AddPanels used to hand-roll
                and stops a 560px panel hanging off the right edge of
                a card on a phone. See PlanAddDrawers. */}
            <PlanAddDrawers
              roster={roster}
              sfaOptions={sfaOptions}
              goalOptions={goalOptions}
              priorityChoices={priorityChoices}
              quarterId={selectedQuarter?.id ?? null}
              noParentValue={NO_PARENT}
              defaultOwnerId={session.profile.id}
              defaultDueDate={defaultDueDate}
            />
          </MobileAddMenu>
        ) : null}
      </div>

      <PlanCascadeController companyId={companyId}>
          <div className={styles.cascade}>
            {cascade.sfas.length === 0 && cascade.orphanGoals.length === 0 &&
              cascade.orphanPriorities.length === 0 ? (
              <EmptyCascade isAdmin={isAdmin} />
            ) : null}

            {cascade.sfas.map((sfa) => (
              <details
                key={sfa.id}
                id={sfaAnchorId(sfa.id)}
                className={styles.sfaCard}
                data-sfa-id={sfa.id}
                open
              >
                <summary className={styles.sfaSummary}>
                  <div className={styles.summaryMain}>
                    <span className={styles.levelLabel}>
                      Focus Area
                    </span>
                    <Link
                      href={`/plan/sfa/${sfa.id}`}
                      className={styles.sfaTitle}
                    >
                      {sfa.title}
                    </Link>
                    <span className={styles.sponsorLabel}>
                      Sponsor: {sfa.sponsor?.full_name ?? "No sponsor yet"}
                    </span>
                  </div>
                  <div className={styles.summaryEnd}>
                    <StatusChip status={sfa.status} />
                    <ProgressBar
                      percent={sfa.percent}
                      label="No progress yet"
                    />
                  </div>
                </summary>

                <div className={styles.sfaBody}>
                  {/* Goals and direct priorities are PEERS here: one
                      list, same indent, each row named by its own
                      level eyebrow. `sfa_progress` averages them
                      one-each, so rendering a priority as a lesser
                      kind of child would contradict the number in
                      the summary above. */}
                  {sfa.goals.length === 0 && sfa.priorities.length === 0 ? (
                    <p className={styles.emptyLine}>
                      Nothing under this focus area yet.
                    </p>
                  ) : (
                    <ul className={styles.rowList}>
                      {sfa.goals.map((goal) => (
                        <li key={goal.id} className={styles.goalItem}>
                          <details
                            id={goalAnchorId(goal.id)}
                            className={styles.goalDetails}
                            data-goal-id={goal.id}
                            open
                          >
                            <summary className={styles.goalSummary}>
                              <div className={styles.summaryMain}>
                                <span className={styles.levelLabel}>
                                  Goal
                                </span>
                                <Link
                                  href={`/plan/goal/${goal.id}`}
                                  className={styles.goalTitle}
                                >
                                  {goal.title}
                                </Link>
                                <span className={styles.rowMeta}>
                                  {goal.owner?.full_name ?? "Unassigned"}
                                  {goal.target_date
                                    ? ` · Target ${goal.target_date}`
                                    : ""}
                                </span>
                              </div>
                              <div className={styles.summaryEnd}>
                                <StatusChip status={goal.status} />
                                <ProgressBar
                                  percent={goal.percent}
                                  label="No priorities yet"
                                />
                              </div>
                            </summary>
                            <div className={styles.goalBody}>
                              {goal.priorities.length === 0 ? (
                                <p className={styles.emptyLine}>
                                  {selectedQuarter
                                    ? `No priorities for ${selectedQuarter.label} yet.`
                                    : "No priorities yet."}
                                </p>
                              ) : (
                                <ul className={styles.rowList}>
                                  {goal.priorities.map((priority) => (
                                    <CascadePriorityRow
                                      key={priority.id}
                                      priority={priority}
                                    />
                                  ))}
                                </ul>
                              )}

                              {isAdmin && selectedQuarter ? (
                                <details
                                  className={styles.addDetails}
                                  data-testid="goal-add-priority-panel"
                                >
                                  <summary className={styles.addSummaryNested}>
                                    <PlusIcon />Add quarterly priority
                                  </summary>
                                  <AddPriorityForm
                                    quarterId={selectedQuarter.id}
                                    defaultParent={formatParentRef({
                                      kind: "goal",
                                      id: goal.id,
                                    })}
                                    goalOptions={goalOptions}
                                    sfaOptions={sfaOptions}
                                    people={roster}
                                  />
                                </details>
                              ) : null}
                            </div>
                          </details>
                        </li>
                      ))}
                      {sfa.priorities.map((priority) => (
                        <CascadePriorityRow
                          key={priority.id}
                          priority={priority}
                        />
                      ))}
                    </ul>
                  )}

                  {isAdmin ? (
                    <div className={styles.addRow}>
                      {/* name= groups these two so the browser closes
                          one when the other opens — a native exclusive
                          accordion, no JS. Scoped per focus area so
                          opening an add on one card does not reach
                          into another. */}
                      <details
                        className={styles.addDetails}
                        name={`sfa-add-${sfa.id}`}
                        data-testid="sfa-add-goal-panel"
                      >
                        <summary className={styles.addSummary}>
                          <PlusIcon />Add goal
                        </summary>
                        <AddGoalForm
                          defaultSfaId={sfa.id}
                          sfaOptions={sfaOptions}
                          people={roster}
                        />
                      </details>

                      {selectedQuarter ? (
                        <details
                          className={styles.addDetails}
                          name={`sfa-add-${sfa.id}`}
                          data-testid="sfa-add-priority-panel"
                        >
                          <summary className={styles.addSummary}>
                            <PlusIcon />Add quarterly priority
                          </summary>
                          <AddPriorityForm
                            quarterId={selectedQuarter.id}
                            defaultParent={formatParentRef({
                              kind: "sfa",
                              id: sfa.id,
                            })}
                            goalOptions={goalOptions}
                            sfaOptions={sfaOptions}
                            people={roster}
                          />
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </details>
            ))}

            {/* Orphan goals — never hidden per Section 8.3 */}
            {cascade.orphanGoals.length > 0 ? (
              <section className={styles.orphanCard} aria-labelledby="orphan-goals">
                <header className={styles.orphanHeader}>
                  <h2 id="orphan-goals" className={styles.orphanTitle}>
                    Goals without a focus area
                  </h2>
                  <p className={styles.orphanNote}>
                    These are ready to be linked whenever you decide where they belong.
                  </p>
                </header>
                <ul className={styles.rowList}>
                  {cascade.orphanGoals.map((goal) => (
                    <li
                      key={goal.id}
                      id={goalAnchorId(goal.id)}
                      className={styles.goalItem}
                    >
                      <div className={styles.summaryMain}>
                        <span className={styles.levelLabel}>
                          Goal
                        </span>
                        <Link
                          href={`/plan/goal/${goal.id}`}
                          className={styles.goalTitle}
                        >
                          {goal.title}
                        </Link>
                        <span className={styles.rowMeta}>
                          {goal.owner?.full_name ?? "Unassigned"}
                          {goal.target_date ? ` · Target ${goal.target_date}` : ""}
                        </span>
                      </div>
                      <div className={styles.summaryEnd}>
                        <StatusChip status={goal.status} />
                        <ProgressBar
                          percent={goal.percent}
                          label="No priorities yet"
                        />
                        {isAdmin ? (
                          <LinkGoalToSfaSelect
                            goalId={goal.id}
                            currentSfaId={null}
                            options={sfaOptions}
                          />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Orphan priorities — same treatment */}
            {cascade.orphanPriorities.length > 0 ? (
              <section
                className={styles.orphanCard}
                aria-labelledby="orphan-priorities"
              >
                <header className={styles.orphanHeader}>
                  <h2 id="orphan-priorities" className={styles.orphanTitle}>
                    Standalone Quarterly Priorities
                  </h2>
                  <p className={styles.orphanNote}>
                    Priorities that aren&rsquo;t tied to a goal or a focus area yet. Link one when the plan takes shape.
                  </p>
                </header>
                <ul className={styles.rowList}>
                  {cascade.orphanPriorities.map((priority) => (
                    <CascadePriorityRow
                      key={priority.id}
                      priority={priority}
                      trailing={
                        isAdmin ? (
                          <LinkPriorityToParentSelect
                            priorityId={priority.id}
                            currentParent={NO_PARENT}
                            goalOptions={goalOptions}
                            sfaOptions={sfaOptions}
                          />
                        ) : null
                      }
                    />
                  ))}
                </ul>
              </section>
            ) : null}

          </div>
          </PlanCascadeController>

    </PageShell>
  );
}

function EmptyCascade({ isAdmin }: { isAdmin: boolean }) {
  return (
    <section className={styles.emptyCard}>
      <p className={styles.emptyLead}>
        This plan is a blank canvas.
      </p>
      <p className={styles.emptyLine}>
        {isAdmin
          ? "Start with a focus area or drop a goal in directly — you can link it up later."
          : "Your team's plan for this quarter will appear here once it's set up."}
      </p>
    </section>
  );
}
