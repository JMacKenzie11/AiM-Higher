import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { getCascade, getBulkResetImpact } from "@/lib/plan/service";
import { BulkResetButton } from "./BulkResetButton";
import { getQuartersForCompany } from "@/lib/quarters/service";
import { StatusChip } from "@/components/plan/StatusChip";
import { ProgressBar } from "@/components/plan/ProgressBar";
import { QuarterSwitcher } from "./QuarterSwitcher";
import { AddSfaForm } from "./AddSfaForm";
import { AddGoalForm } from "./AddGoalForm";
import { AddPriorityForm } from "./AddPriorityForm";
import { LinkGoalToSfaSelect } from "./LinkGoalToSfaSelect";
import { LinkPriorityToGoalSelect } from "./LinkPriorityToGoalSelect";
import { PlanCascadeController } from "./PlanCascadeController";
import styles from "./plan.module.css";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// Plan workspace — Section 8.3.

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

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
  const resetImpact = await getBulkResetImpact(companyId);

  const supabase = await createSupabaseServerClient();
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("company_id", companyId)
    .order("full_name");
  const roster = (people ?? []) as Pick<Profile, "id" | "full_name">[];

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";

  const sfaOptions = cascade.sfas.map((sfa) => ({ id: sfa.id, title: sfa.title }));
  const goalOptions = [
    ...cascade.sfas.flatMap((sfa) =>
      sfa.goals.map((g) => ({ id: g.id, title: g.title }))
    ),
    ...cascade.orphanGoals.map((g) => ({ id: g.id, title: g.title })),
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Strategic Plan</h1>
        <span className="aims-rule" aria-hidden="true" />
        <p className={styles.subtitle}>
          The cascade for your company, one quarter at a time.
        </p>
      </header>

      {/* Toolbar is always visible. SFAs and annual goals aren't
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
          <div className={styles.toolbarActions}>
            {!openQuarter ? (
              <Link href="/quarters" className={styles.toolbarGhost}>
                + {quarters.length === 0 ? "Open your first quarter" : "Open next quarter"}
              </Link>
            ) : null}
            <details className={styles.toolbarAddDetails}>
              <summary className={styles.toolbarAddSummary}>
                + Add Strategic Focus Area
              </summary>
              <div className={styles.toolbarAddPanel}>
                <AddSfaForm people={roster} />
              </div>
            </details>
            <details className={styles.toolbarAddDetails}>
              <summary className={styles.toolbarAddSummary}>
                + Add Annual Goal
              </summary>
              <div className={styles.toolbarAddPanel}>
                <AddGoalForm
                  defaultSfaId={null}
                  sfaOptions={sfaOptions}
                  people={roster}
                />
              </div>
            </details>
            <BulkResetButton
              companyId={companyId}
              sfaCount={resetImpact.sfaCount}
              goalCount={resetImpact.goalCount}
              priorityCount={resetImpact.priorityCount}
            />
          </div>
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
                className={styles.sfaCard}
                data-sfa-id={sfa.id}
                open
              >
                <summary className={styles.sfaSummary}>
                  <div className={styles.summaryMain}>
                    <span className={styles.levelLabel}>
                      Strategic Focus Area
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
                  {sfa.goals.length === 0 ? (
                    <p className={styles.emptyLine}>
                      No annual goals attached yet.
                    </p>
                  ) : (
                    <ul className={styles.rowList}>
                      {sfa.goals.map((goal) => (
                        <li key={goal.id} className={styles.goalItem}>
                          <details
                            className={styles.goalDetails}
                            data-goal-id={goal.id}
                            open
                          >
                            <summary className={styles.goalSummary}>
                              <div className={styles.summaryMain}>
                                <span className={styles.levelLabel}>
                                  Annual Goal
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
                                    <li key={priority.id} className={styles.priorityItem}>
                                      <div className={styles.summaryMain}>
                                        <span className={styles.levelLabel}>
                                          90-Day Priority
                                        </span>
                                        <Link
                                          href={`/plan/priority/${priority.id}`}
                                          className={styles.priorityTitle}
                                        >
                                          {priority.title}
                                        </Link>
                                        <span className={styles.rowMeta}>
                                          {priority.owner?.full_name ?? "Unassigned"}
                                          {priority.due_date
                                            ? ` · Due ${priority.due_date}`
                                            : ""}
                                          {" · "}
                                          {priority.commitment_count} commitment
                                          {priority.commitment_count === 1 ? "" : "s"}
                                        </span>
                                      </div>
                                      <div className={styles.summaryEnd}>
                                        <StatusChip status={priority.status} />
                                        <ProgressBar
                                          percent={priority.percent}
                                          label="No commitments yet"
                                        />
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}

                              {isAdmin && selectedQuarter ? (
                                <details className={styles.addDetails}>
                                  <summary className={styles.addSummary}>
                                    + Add priority
                                  </summary>
                                  <AddPriorityForm
                                    quarterId={selectedQuarter.id}
                                    defaultGoalId={goal.id}
                                    goalOptions={goalOptions}
                                    people={roster}
                                  />
                                </details>
                              ) : null}
                            </div>
                          </details>
                        </li>
                      ))}
                    </ul>
                  )}

                  {isAdmin ? (
                    <details className={styles.addDetails}>
                      <summary className={styles.addSummary}>
                        + Add annual goal
                      </summary>
                      <AddGoalForm
                        defaultSfaId={sfa.id}
                        sfaOptions={sfaOptions}
                        people={roster}
                      />
                    </details>
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
                    <li key={goal.id} className={styles.goalItem}>
                      <div className={styles.summaryMain}>
                        <span className={styles.levelLabel}>
                          Annual Goal
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
                    Priorities without a goal
                  </h2>
                  <p className={styles.orphanNote}>
                    Attach these to an annual goal to link them to the plan.
                  </p>
                </header>
                <ul className={styles.rowList}>
                  {cascade.orphanPriorities.map((priority) => (
                    <li key={priority.id} className={styles.priorityItem}>
                      <div className={styles.summaryMain}>
                        <span className={styles.levelLabel}>
                          90-Day Priority
                        </span>
                        <Link
                          href={`/plan/priority/${priority.id}`}
                          className={styles.priorityTitle}
                        >
                          {priority.title}
                        </Link>
                        <span className={styles.rowMeta}>
                          {priority.owner?.full_name ?? "Unassigned"}
                          {priority.due_date ? ` · Due ${priority.due_date}` : ""}
                          {" · "}
                          {priority.commitment_count} commitment
                          {priority.commitment_count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className={styles.summaryEnd}>
                        <StatusChip status={priority.status} />
                        <ProgressBar
                          percent={priority.percent}
                          label="No commitments yet"
                        />
                        {isAdmin ? (
                          <LinkPriorityToGoalSelect
                            priorityId={priority.id}
                            currentGoalId={null}
                            options={goalOptions}
                          />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {isAdmin && cascade.sfas.length === 0 ? (
              <section className={styles.addCard} aria-labelledby="add-orphan-goal">
                <h2 id="add-orphan-goal" className={styles.orphanTitle}>
                  Add an annual goal
                </h2>
                <AddGoalForm
                  defaultSfaId={null}
                  sfaOptions={sfaOptions}
                  people={roster}
                />
              </section>
            ) : null}

            {isAdmin && selectedQuarter && cascade.orphanGoals.length === 0 &&
              cascade.sfas.every((sfa) => sfa.goals.length === 0) ? (
              <section
                className={styles.addCard}
                aria-labelledby="add-orphan-priority"
              >
                <h2 id="add-orphan-priority" className={styles.orphanTitle}>
                  Add a priority
                </h2>
                <AddPriorityForm
                  quarterId={selectedQuarter.id}
                  defaultGoalId={null}
                  goalOptions={goalOptions}
                  people={roster}
                />
              </section>
            ) : null}
          </div>
          </PlanCascadeController>
    </div>
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
          : "Your company admin hasn't set up the cascade yet."}
      </p>
    </section>
  );
}
