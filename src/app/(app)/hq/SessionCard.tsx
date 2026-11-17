import type { SessionCard as SessionCardData } from "@/lib/hq/calls";
import type { MyCommitmentRow } from "@/lib/hq/service";
import { shortDay } from "@/lib/hq/derive";
import { ScopeIntoCompanyButton } from "../admin/companies/ScopeIntoCompanyButton";
import { MarkDoneButton, SessionBrief } from "./SessionBrief";
import styles from "./hq.module.css";
import t from "./hq-tabs.module.css";

// "Your next session with {company}", on the Coaching calls tab when a
// company chip is chosen. Three columns: what changed since the last
// coaching call (four weeks back when there has been none, and it says
// so), where that call left off (its Decisions Made, and the coach's
// own open commitments for the company), then coaching notes below.
// Everything but the notes is read from what is stored (calls.ts);
// nothing here is generated.

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function SessionCard({
  card,
  promises,
  brief,
}: {
  card: SessionCardData;
  promises: MyCommitmentRow[];
  brief: { id: string; content: string; createdAt: string } | null;
}) {
  const since = shortDay(card.since.iso);
  return (
    <section className={`${styles.card} ${t.sessionCard}`} aria-labelledby="hq-session">
      <div className={t.headRow}>
        <div>
          <h2 id="hq-session" className={t.sessionTitle}>
            Your next session with {card.companyName}
          </h2>
          <p className={t.caption}>
            {card.lastCall
              ? `Last call ${shortDay(card.lastCall.heldOn)}${
                  card.lastCall.attendees.length > 0 ? ` with ${listNames(card.lastCall.attendees)}` : ""
                }.`
              : "No coaching call with this company yet."}
          </p>
        </div>
        <ScopeIntoCompanyButton companyId={card.companyId} className={t.textLinkButton}>
          Work inside {card.companyName}
        </ScopeIntoCompanyButton>
      </div>

      <div className={t.twoCols}>
        <div className={t.column}>
          <h3 className={t.columnHead}>{card.since.fromCall ? "Since your last call" : `Since ${since}`}</h3>
          {card.since.fromCall ? null : (
            <p className={t.columnText}>There is no coaching call yet, so this looks back four weeks.</p>
          )}
          {card.followThrough ? (
            <p className={t.columnText}>
              <strong className={card.followThrough.tone === "down" ? t.toneDown : card.followThrough.tone === "up" ? t.toneUp : t.strong}>
                {card.followThrough.text}
              </strong>
            </p>
          ) : (
            <p className={t.columnText}>No follow-through to compare yet.</p>
          )}
          {card.overdue.length > 0 ? (
            <p className={t.columnText}>
              <strong className={t.toneDown}>
                {card.overdue.length === 1 ? "One priority now overdue:" : `${card.overdue.length} priorities now overdue:`}
              </strong>{" "}
              {card.overdue
                .slice(0, 3)
                .map((p) => `${p.title}, due ${shortDay(p.dueDate)}`)
                .join("; ")}
              .
            </p>
          ) : (
            <p className={t.columnText}>No priority has become overdue.</p>
          )}
          {card.teamMeetings.length > 0 ? (
            card.teamMeetings.slice(0, 3).map((m) => (
              <p key={m.id} className={t.columnText}>
                <strong className={t.strong}>Team met {shortDay(m.heldOn)}:</strong> {plural(m.commitments, "commitment")},{" "}
                {plural(m.issues, "issue")}.{m.facilitation !== null ? ` Facilitation ${m.facilitation}/10.` : ""}
              </p>
            ))
          ) : (
            <p className={t.columnText}>No team meeting recorded.</p>
          )}
          <p className={t.columnText}>
            <strong className={t.strong}>
              {card.newOpenIssues === 0 ? "No new issues" : `${plural(card.newOpenIssues, "new issue")}`}
            </strong>{" "}
            open on Issues.
          </p>
        </div>

        <div className={t.column}>
          <h3 className={t.columnHead}>Where you left off</h3>
          {card.leftOff ? (
            <>
              {card.leftOff.kind === "summary" ? (
                <p className={t.caption}>The last call recorded no decisions. It was about:</p>
              ) : null}
              <ul className={t.leftOff}>
                {card.leftOff.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className={t.columnText}>
              {card.lastCall ? "The last call's summary has no decisions to show." : "Your first call starts the record."}
            </p>
          )}
          {promises.map((p) => (
            <div key={p.id} className={t.promise}>
              <strong className={t.strong}>Your promise:</strong> {p.description}
              {p.due_date ? `, due ${shortDay(p.due_date)}` : ""}. <MarkDoneButton commitmentId={p.id} />
            </div>
          ))}
        </div>

      </div>

      {/* Coaching notes, full width under the two columns (Jason,
          2026-11-17: down the right side they were squeezed). */}
      <SessionBrief companyId={card.companyId} initial={brief} newSince={newSinceNotes(card)} />
    </section>
  );
}

// What arrived for the company most recently: the last coaching call
// or a team meeting since it. Notes written before it are out of date
// (Jason, 2026-11-17): the card hides them and offers new ones.
function newSinceNotes(card: SessionCardData): { label: string; heldOn: string } | null {
  const events: Array<{ label: string; heldOn: string }> = [];
  if (card.lastCall) events.push({ label: `the coaching call on ${shortDay(card.lastCall.heldOn)}`, heldOn: card.lastCall.heldOn });
  for (const m of card.teamMeetings) events.push({ label: `the team meeting on ${shortDay(m.heldOn)}`, heldOn: m.heldOn });
  events.sort((a, b) => (a.heldOn < b.heldOn ? 1 : a.heldOn > b.heldOn ? -1 : 0));
  return events[0] ?? null;
}

function listNames(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
