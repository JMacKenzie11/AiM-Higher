import Link from "next/link";
import type { Profile } from "@/lib/types";
import { canWriteOwnedRow } from "@/lib/auth/permissions";
import { getCommitmentsPageData } from "@/lib/commitments/service";
import { isNeedsAttention } from "@/lib/commitments/needs-attention";
import { getGridData } from "@/lib/measures/grid";
import { numbersToLog } from "@/lib/measures/to-log";
import { formatShortDate } from "@/lib/dates";
import { PageShell } from "@/components/ui/PageShell";
import { CommitmentRow } from "../commitments/CommitmentRow";
import { InlineAddRow } from "../commitments/InlineAddRow";
import commitmentStyles from "../commitments/commitments.module.css";
import styles from "./dashboard.module.css";

// MY WEEK: a team member's Home (simplification review, change 3, the
// "my-week" switch).
//
// Week in Review answers "how is the company doing", which is an
// admin's question. A team member opens the app to see what they owe
// and to close something out, and Week in Review never listed their
// own commitments, so that took four clicks over three screens. This
// is the answer to their question, first: their open commitments,
// late ones on top, with the add row above them; then, for someone
// who leads a function, how many of this week's numbers are still to
// log. The company view stays one link away.
//
// Nothing here is new data. The commitments come from the same loader
// as /commitments, filtered to "me" and "open"; the numbers count is
// the one /measures shows above its grid, worked out the same way.

export async function MyWeek({
  profile,
  companyId,
  timezone,
}: {
  profile: Profile;
  companyId: string;
  timezone: string;
}) {
  const [data, grid] = await Promise.all([
    getCommitmentsPageData(companyId, profile.id, { owner: "me", status: "open", type: "all" }),
    getGridData(companyId, profile.id, timezone, false),
  ]);

  const mine = data.mainList.filter((c) => c.owner_id === profile.id && c.status === "open");
  const late = mine.filter((c) => isNeedsAttention(c, data.thisFriday));
  // Late first, then by due date: what needs doing soonest leads.
  const ordered = [...late, ...mine.filter((c) => !late.includes(c))].sort((a, b) => {
    const la = late.includes(a) ? 0 : 1;
    const lb = late.includes(b) ? 0 : 1;
    return la - lb || a.due_date.localeCompare(b.due_date);
  });
  const later = data.futureList.filter((c) => c.owner_id === profile.id).length;

  const numbers = numbersToLog(grid);

  const roster = data.roster.map((p) => ({ id: p.id, full_name: p.full_name }));
  const name = profile.first_name?.trim();

  return (
    <PageShell
      eyebrow="Home"
      title={name ? `Your week, ${name}` : "Your week"}
      subtitle={
        mine.length === 0
          ? "Nothing open on your list."
          : `${mine.length} open${late.length > 0 ? `, ${late.length} past due` : ""}. Due by ${formatShortDate(data.thisFriday)}.`
      }
    >
      <section className={`${commitmentStyles.group} ${commitmentStyles.addFirst}`} aria-label="Add a commitment">
        <InlineAddRow
          thisFriday={data.thisFriday}
          priorityOptions={data.priorityOptions}
          functionalAreaOptions={data.functionalAreaOptions}
          roster={roster}
          currentUserId={profile.id}
          isAdmin={false}
        />
      </section>

      <section className={commitmentStyles.group} aria-labelledby="my-week-list">
        <div className={commitmentStyles.groupHeader}>
          <h2 id="my-week-list" className={commitmentStyles.groupTitle}>
            Your commitments
          </h2>
          <span className={commitmentStyles.groupMeta}>
            {mine.length} open
          </span>
        </div>
        {ordered.length > 0 ? (
          <ul className={`${commitmentStyles.rowList} ${styles.myWeekList}`}>
            {ordered.map((c) => (
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
                isAdmin={false}
              />
            ))}
          </ul>
        ) : (
          <p className={styles.myWeekEmpty}>
            Nothing open. Add what you&rsquo;ll do next in the box above.
          </p>
        )}
        {later > 0 ? (
          <p className={styles.myWeekMore}>
            {later} more due after this week.{" "}
            <Link href="/commitments?owner=me">See them all</Link>
          </p>
        ) : null}
      </section>

      {numbers.due > 0 ? (
        <section className={commitmentStyles.group} aria-labelledby="my-week-numbers">
          <div className={commitmentStyles.groupHeader}>
            <h2 id="my-week-numbers" className={commitmentStyles.groupTitle}>
              Your numbers
            </h2>
          </div>
          <p className={styles.myWeekLine}>
            {numbers.outstanding === 0
              ? `All ${numbers.due} logged for the week ending ${formatShortDate(numbers.week)}.`
              : `${numbers.outstanding} of ${numbers.due} still to log for the week ending ${formatShortDate(numbers.week)}.`}{" "}
            <Link href="/measures">{numbers.outstanding === 0 ? "Open Critical Success Factors" : "Log them"}</Link>
          </p>
        </section>
      ) : null}

      <p className={styles.myWeekFoot}>
        <Link href="/dashboard?view=company">How the company&rsquo;s week is going</Link>
      </p>
    </PageShell>
  );
}
