import type { ReactNode } from "react";
import type { NoteRow, ParticipantRow, QuoteRow } from "@/lib/diagnostics/types";
import { CONVERSATION_GUIDE, OPENING_LINE } from "@/lib/diagnostics/conversation-guide";
import { StepCard } from "./StepCard";
import { Notes } from "./Notes";
import { Quotes } from "./Quotes";
import styles from "../diagnostics.module.css";

// 4. CONVERSATIONS. Thirty minutes each, with five to eight of the
// people in scope: the guide on the left, read as written, and the
// notes for the person on the right, saved as the cursor leaves each
// box. Pull a quote turns selected words into a line the readout may
// use, once the lead approves it.

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
