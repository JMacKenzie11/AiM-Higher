import Link from "next/link";
import { CompanyNameLink } from "../admin/companies/CompanyNameLink";
import type { CompanyRollup } from "@/lib/hq/service";
import { CALL_STALE_DAYS, daysAgoLabel, daysSince, prepareHref, shortDay, type Change } from "@/lib/hq/derive";
import ui from "@/components/ui/ui.module.css";
import styles from "./hq.module.css";
import t from "./hq-tabs.module.css";

// Your companies: one row per company in the caseload. The name scopes
// into the company (CompanyNameLink, a button, never a link: see
// scope-request.ts). Scorecard and Follow-through carry a change
// against four weeks ago when both sides have data, "no change" when
// they are equal, and nothing when four weeks ago has no data. The
// meeting column is the last TEAM meeting; the coaching column is the
// last coaching call, amber past CALL_STALE_DAYS. Prepare opens the
// Coaching calls tab on the company (not on the oversight view).

function ChangeMark({ change, unit = "" }: { change: Change | null; unit?: string }) {
  if (!change) return null;
  if (change.direction === "same") return <span className={t.changeSame}>no change</span>;
  const up = change.direction === "up";
  return (
    <span className={up ? t.changeUp : t.changeDown}>
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      <span className={t.srOnly}>{up ? "up" : "down"}</span> {change.amount}
      {unit}
    </span>
  );
}

export function YourCompaniesSection({
  rows,
  needsYou,
  prepare = true,
  nowMs,
}: {
  rows: CompanyRollup[];
  needsYou: ReadonlySet<string>;
  // False on the oversight view: no Prepare, and no coaching-call
  // column, since calls are the coach's own (RLS would show none).
  prepare?: boolean;
  nowMs: number;
}) {
  return (
    <section className={styles.card} aria-labelledby="hq-companies">
      <div className={t.headRow}>
        <h2 id="hq-companies" className={styles.h2}>
          Your companies
        </h2>
        <span className={t.caption}>Arrows compare with four weeks ago. Click a company to work inside it.</span>
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>No companies assigned.</p>
      ) : (
        <div className={t.tableScroll}>
          <table className={t.table}>
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Scorecard</th>
                <th scope="col">Follow-through</th>
                <th scope="col">Priorities</th>
                <th scope="col">Last team meeting</th>
                {prepare ? <th scope="col">Last coaching call</th> : null}
                {prepare ? (
                  <th scope="col">
                    <span className={t.srOnly}>Prepare</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const callDays = row.lastCoachingCall ? daysSince(row.lastCoachingCall, nowMs) : null;
                return (
                  <tr key={row.id}>
                    <td>
                      <CompanyNameLink companyId={row.id} name={row.name} className={styles.attentionNameLink} />
                      {needsYou.has(row.id) ? <div className={t.needsMark}>Needs you</div> : null}
                    </td>
                    <td className={t.nowrap}>
                      {row.scorecardOverall === null ? (
                        "Not scored yet"
                      ) : (
                        <>
                          {row.scorecardOverall} <span className={t.muted}>/10</span>{" "}
                          <ChangeMark change={row.scorecardChange} />
                        </>
                      )}
                    </td>
                    <td className={t.nowrap}>
                      {row.followThroughRate === null ? (
                        "No data yet"
                      ) : (
                        <>
                          {row.followThroughRate}% <ChangeMark change={row.followThroughChange} />
                        </>
                      )}
                    </td>
                    <td>
                      {row.priorities ? (
                        <span className={t.nowrap}>
                          {row.priorities.onTrack} on track
                          {row.priorities.overdue > 0 ? (
                            <>
                              {" · "}
                              <span className={t.overdue}>{row.priorities.overdue} overdue</span>
                            </>
                          ) : null}
                        </span>
                      ) : (
                        "No open quarter"
                      )}
                      {row.openQuarterLabel ? (
                        <div className={t.sub}>
                          {row.openQuarterLabel}
                          {/* A lapsed quarter is a nudge, not a failure:
                              its priorities have stopped matching the
                              period the team is working. */}
                          {row.openQuarterLapsed ? <span className={styles.quarterLapsed}> ended</span> : null}
                        </div>
                      ) : null}
                    </td>
                    <td className={t.nowrap}>
                      {row.lastMet ? (
                        <>
                          {shortDay(row.lastMet)}
                          {row.lastMetFacilitation !== null ? (
                            <div className={t.sub}>Facilitation {row.lastMetFacilitation}/10</div>
                          ) : null}
                        </>
                      ) : (
                        "None yet"
                      )}
                    </td>
                    {prepare ? (
                      <td className={t.nowrap}>
                        {row.lastCoachingCall && callDays !== null ? (
                          <>
                            {shortDay(row.lastCoachingCall)}
                            <div className={callDays > CALL_STALE_DAYS ? t.subAmber : t.sub}>{daysAgoLabel(callDays)}</div>
                          </>
                        ) : (
                          "None yet"
                        )}
                      </td>
                    ) : null}
                    {prepare ? (
                      <td className={t.right}>
                        <Link href={prepareHref(row.id)} className={`${ui.btn} ${ui.btnSecondary}`} scroll={false}>
                          Prepare<span className={t.srOnly}> a session with {row.name}</span>
                        </Link>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
