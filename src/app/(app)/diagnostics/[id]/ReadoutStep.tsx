import Link from "next/link";
import type { ReactNode } from "react";
import { publishBlocker, readoutSections, type ReadoutData } from "@/lib/diagnostics/readout";
import { decisionLabel, type DiagnosticRow } from "@/lib/diagnostics/types";
import { StepCard } from "./StepCard";
import { DecisionButtons, NarrativeFields, PublishButton, RoadmapEditor, WriteNarrativeButton } from "./ReadoutControls";
import { shortDate } from "../format";
import styles from "../diagnostics.module.css";

// 6. READOUT. The readout in the order it runs, assembled from what the
// engagement collected (lib/diagnostics/readout.ts). The lead adds the
// roadmap and the narrative, opens the readout to check it, publishes
// it, and records the decision. Publishing fixes the readout: from then
// on the readout page and the PDF show the published copy.
export function ReadoutStep({ diagnostic, readout, footer }: { diagnostic: DiagnosticRow; readout: ReadoutData; footer: ReactNode }) {
  const id = diagnostic.id;
  const published = Boolean(diagnostic.published_at);
  const blocker = publishBlocker(readout);
  const roadmap = diagnostic.roadmap.length
    ? diagnostic.roadmap
    : readout.nextWins.map((w) => ({ title: w.title, target_week: null, champion: "" }));
  const written = Object.keys(diagnostic.narrative ?? {}).length > 0;

  return (
    <>
      <StepCard
        id="dx-readout"
        title="The readout"
        meta={published ? `Published ${shortDate(diagnostic.published_at!.slice(0, 10))}` : "Draft"}
      >
        <div className={styles.body}>
          <p className={styles.muted}>
            {published
              ? "This is the readout the owner receives. It no longer changes."
              : "The readout shows the current figures until you publish it. Open it to check what the owner will see."}
          </p>
          <span className={styles.formRow}>
            <Link href={`/diagnostics/${id}/readout`} className={styles.secondary}>
              Open the readout
            </Link>
            <a href={`/diagnostics/${id}/readout/pdf`} className={styles.secondary}>
              Download the PDF
            </a>
            <a href={`/diagnostics/${id}/readout/markdown`} className={styles.secondary}>
              Download the roadmap as Markdown
            </a>
          </span>
        </div>
      </StepCard>

      <StepCard id="dx-roadmap" title="The 90-day roadmap" meta="Three next wins, the week each lands, and who to train">
        <RoadmapEditor diagnosticId={id} items={roadmap} locked={published} />
      </StepCard>

      <StepCard
        id="dx-narrative"
        title="The narrative"
        meta="One short paragraph for each section"
        action={published ? undefined : <WriteNarrativeButton diagnosticId={id} written={written} />}
      >
        <NarrativeFields diagnosticId={id} narrative={diagnostic.narrative ?? {}} sections={readoutSections(readout)} locked={published} />
      </StepCard>

      <StepCard id="dx-publish" title={published ? "Decision" : "Publish and decide"} footer={footer}>
        <div className={styles.body}>
          {published ? null : <PublishButton diagnosticId={id} blocker={blocker} />}
          <p className={styles.muted}>
            Decision: {decisionLabel(diagnostic.decision)}
            {diagnostic.decided_at ? `, recorded ${shortDate(diagnostic.decided_at.slice(0, 10))}` : ""}. Recording it changes nothing else on AiMS HQ; a sprint is set up by hand.
          </p>
          <DecisionButtons diagnosticId={id} decision={diagnostic.decision} />
        </div>
      </StepCard>
    </>
  );
}
