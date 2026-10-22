import type { ReactNode } from "react";
import type { NoteRow, ParticipantRow, QuoteRow } from "@/lib/diagnostics/types";
import { StepCard } from "./StepCard";
import { Notes } from "./Notes";
import { Quotes } from "./Quotes";
import styles from "../diagnostics.module.css";

// 4. CONVERSATIONS. Thirty minutes each, with five to eight of the
// people in scope: the guide on the left, read as written, and the
// notes for the person on the right, saved as the cursor leaves each
// box. Pull a quote turns selected words into a line the readout may
// use, once the lead approves it.

export const OPENING_LINE =
  "What you tell me stays with me. The owner sees combined results, never your individual ratings or answers.";

export const CONVERSATION_GUIDE = [
  "Tell me about a time in the last year when you finished a day here feeling like you had done your best work. What were you doing, and what did you bring to it that made it go well?",
  "Which parts of your week get in the way of more days like that?",
  "If a tool handled the first draft, the lookup, or the paperwork on one of those, what would it have to get right for you to use it?",
  "What would you want the owner to understand about how your work actually happens?",
  "With a few hours back each week, what is the first thing you would put them toward?",
] as const;

export function ConversationsStep({
  diagnosticId,
  participants,
  notes,
  quotes,
  footer,
}: {
  diagnosticId: string;
  participants: ParticipantRow[];
  notes: NoteRow[];
  quotes: QuoteRow[];
  footer: ReactNode;
}) {
  const had = participants.filter((p) => p.in_conversations).length;
  return (
    <>
      <StepCard id="step-conversations" title="Conversations" meta={`${had} of ${participants.length} had one`}>
        {participants.length === 0 ? (
          <p className={styles.empty}>Add the people in scope on the Kickoff step first.</p>
        ) : (
          <div className={styles.conversation}>
            <div>
              <h3 className={styles.cardTitle}>The guide</h3>
              <p className={styles.opening}>{OPENING_LINE}</p>
              <ol className={styles.guide}>
                {CONVERSATION_GUIDE.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </div>
            <Notes diagnosticId={diagnosticId} participants={participants} notes={notes} />
          </div>
        )}
      </StepCard>
      <Quotes quotes={quotes} participants={participants} footer={footer} />
    </>
  );
}
