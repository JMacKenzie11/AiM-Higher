"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  createFunctionCompetencyAction,
  createFunctionDecisionRightAction,
  createFunctionRoleAction,
  createMeasureAction,
  createOutcomeAction,
} from "@/lib/chart/actions";
import { suggestForFunctionAction } from "@/lib/role-descriptions/actions";
import type {
  Recommendation,
  RdTarget,
} from "@/lib/role-descriptions/recommend";
import styles from "../../chart.module.css";

// Right-side drawer that walks the missing gaps on a Function's
// role description, one question at a time. Reads the initial gap
// list from props (computed server-side by the readiness card) and
// keeps local per-session counts as the user adds items — so
// "Continue" enables when the gate passes without re-fetching the
// server on every keystroke. On close, router.refresh() picks up
// the new state so the underlying page (and the readiness card)
// reflect what was added.
//
// No mention of "AI" anywhere in the copy. Recommendations are
// framed as "suggestions" — the platform's opinion, not a
// technology surface.

type StepKind = "responsibilities" | "outcomes" | "measures" | "decision_rights" | "competencies";

type Step = {
  kind: StepKind;
  question: string;
  helperText: string;
  addPlaceholder: string;
  initialCount: number;
  target: number; // gate threshold
  // For "measures", we sequence one step per outcome that has no
  // metric yet. outcomeId + outcomeTitle scope this step.
  outcomeId?: string;
  outcomeTitle?: string;
};

export type InitialGaps = {
  functionId: string;
  companyId: string;
  responsibilities: { count: number; needed: number };
  outcomes: { count: number; needed: number };
  measuresNeededFor: Array<{ outcomeId: string; outcomeTitle: string }>;
  decisionRights: { count: number; needed: number };
  competencies: { count: number; needed: number };
};

export function CompleteRoleDescriptionDrawer({
  open,
  onClose,
  gaps,
}: {
  open: boolean;
  onClose: () => void;
  gaps: InitialGaps;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className={styles.rdDrawerOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rd-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.rdDrawerPanel}>
        <DrawerContent gaps={gaps} onClose={onClose} />
      </div>
    </div>,
    document.body
  );
}

function DrawerContent({
  gaps,
  onClose,
}: {
  gaps: InitialGaps;
  onClose: () => void;
}) {
  const router = useRouter();
  const steps = useMemo(() => buildSteps(gaps), [gaps]);
  const [stepIndex, setStepIndex] = useState(0);
  const [addedByKind, setAddedByKind] = useState<Record<string, number>>({});

  const step = steps[stepIndex];
  const stepKey = step ? stepKeyOf(step) : "";
  const addedThisStep = step ? addedByKind[stepKey] ?? 0 : 0;
  const total = step ? step.initialCount + addedThisStep : 0;
  const gateMet = step ? total >= step.target : true;
  const done = stepIndex >= steps.length;

  function incrementStep() {
    if (!step) return;
    setAddedByKind((prev) => ({
      ...prev,
      [stepKey]: (prev[stepKey] ?? 0) + 1,
    }));
  }

  function goNext() {
    setStepIndex((i) => i + 1);
  }

  function finish() {
    router.refresh();
    onClose();
  }

  return (
    <>
      <header className={styles.rdDrawerHeader}>
        <div>
          <p className={styles.rdDrawerEyebrow}>Role description</p>
          <h2 id="rd-drawer-title" className={styles.rdDrawerTitle}>
            {done ? "You're all set" : "Complete role description"}
          </h2>
          {!done && steps.length > 0 ? (
            <p className={styles.rdDrawerProgress}>
              Step {stepIndex + 1} of {steps.length}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.rdDrawerClose}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <div className={styles.rdDrawerBody}>
        {done ? (
          <div className={styles.rdDrawerDone}>
            <p>
              Every required section has an answer. You can keep refining
              anything here from the function&rsquo;s page, or come back to
              this drawer any time to pick up where you left off.
            </p>
            <button
              type="button"
              className={styles.rdReadinessAction}
              onClick={finish}
            >
              Close
            </button>
          </div>
        ) : step ? (
          <StepPanel
            step={step}
            functionId={gaps.functionId}
            totalNow={total}
            gateMet={gateMet}
            onAdded={incrementStep}
            onContinue={goNext}
            onSkip={goNext}
          />
        ) : null}
      </div>
    </>
  );
}

function StepPanel({
  step,
  functionId,
  totalNow,
  gateMet,
  onAdded,
  onContinue,
  onSkip,
}: {
  step: Step;
  functionId: string;
  totalNow: number;
  gateMet: boolean;
  onAdded: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const [inputTitle, setInputTitle] = useState("");
  const [inputBody, setInputBody] = useState("");
  const [saving, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Recommendation[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [suggesting, startSuggest] = useTransition();
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // Reset local input state whenever the step changes.
  useEffect(() => {
    setInputTitle("");
    setInputBody("");
    setSuggestions(null);
    setDismissed(new Set());
    setSaveError(null);
    setSuggestError(null);
  }, [step]);

  function save(title: string, body: string | null) {
    if (!title.trim()) return;
    setSaveError(null);
    startSave(async () => {
      const result = await writeItem({
        step,
        functionId,
        title: title.trim(),
        body: body?.trim() || null,
      });
      if (!result.ok) {
        setSaveError(result.message);
        return;
      }
      onAdded();
      setInputTitle("");
      setInputBody("");
    });
  }

  function runSuggest() {
    setSuggestError(null);
    setSuggestions(null);
    setDismissed(new Set());
    startSuggest(async () => {
      const result = await suggestForFunctionAction({
        functionId,
        target: rdTargetOf(step.kind),
        outcomeId: step.outcomeId,
      });
      if (!result.ok) {
        setSuggestError(result.message);
        return;
      }
      if (result.recommendations.length === 0) {
        setSuggestError(
          "No suggestions this time. Try adding one yourself or click Suggest again."
        );
        return;
      }
      setSuggestions(result.recommendations);
    });
  }

  function dismissCard(idx: number) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  }

  return (
    <>
      <div className={styles.rdStepIntro}>
        <h3 className={styles.rdStepQuestion}>{step.question}</h3>
        <p className={styles.rdStepHelper}>{step.helperText}</p>
        {step.outcomeTitle ? (
          <p className={styles.rdStepAnchor}>
            For outcome: <strong>{step.outcomeTitle}</strong>
          </p>
        ) : null}
        <p className={styles.rdStepCount}>
          {totalNow} of {step.target} added{gateMet ? " ✓" : ""}
        </p>
      </div>

      <form
        className={styles.rdAddForm}
        onSubmit={(e) => {
          e.preventDefault();
          save(inputTitle, inputBody || null);
        }}
      >
        <label className={styles.rdAddLabel}>
          <span className={styles.rdAddLabelText}>Your answer</span>
          <input
            type="text"
            value={inputTitle}
            onChange={(e) => setInputTitle(e.target.value)}
            placeholder={step.addPlaceholder}
            className={styles.rdAddInput}
            disabled={saving}
            autoFocus
          />
        </label>
        {step.kind !== "measures" ? (
          <label className={styles.rdAddLabel}>
            <span className={styles.rdAddLabelText}>
              Optional context / why it matters
            </span>
            <textarea
              value={inputBody}
              onChange={(e) => setInputBody(e.target.value)}
              rows={2}
              className={styles.rdAddTextarea}
              disabled={saving}
            />
          </label>
        ) : null}
        <div className={styles.rdActionRow}>
          <button
            type="submit"
            className={styles.rdReadinessAction}
            disabled={saving || !inputTitle.trim()}
          >
            {saving ? "Saving…" : "Add"}
          </button>
          <button
            type="button"
            className={styles.rdSecondaryButton}
            onClick={runSuggest}
            disabled={suggesting}
          >
            {suggesting ? "Thinking…" : "Suggest 3 for me"}
          </button>
        </div>
        {saveError ? (
          <p role="alert" className={styles.rdError}>
            {saveError}
          </p>
        ) : null}
        {suggestError ? (
          <p role="alert" className={styles.rdError}>
            {suggestError}
          </p>
        ) : null}
      </form>

      {suggestions && suggestions.length > 0 ? (
        <div className={styles.rdSuggestionList}>
          <p className={styles.rdSuggestionHeading}>Suggestions</p>
          {suggestions.map((rec, i) =>
            dismissed.has(i) ? null : (
              <SuggestionCard
                key={i}
                rec={rec}
                saving={saving}
                onUse={() => save(rec.title, rec.body)}
                onEdit={() => {
                  setInputTitle(rec.title);
                  setInputBody(rec.body ?? "");
                  dismissCard(i);
                }}
                onSkip={() => dismissCard(i)}
              />
            )
          )}
          <button
            type="button"
            className={styles.rdSecondaryButton}
            onClick={runSuggest}
            disabled={suggesting}
          >
            {suggesting ? "Thinking…" : "Suggest 3 more"}
          </button>
        </div>
      ) : null}

      <div className={styles.rdStepFooter}>
        <button
          type="button"
          className={styles.rdReadinessAction}
          onClick={onContinue}
          disabled={!gateMet}
          title={gateMet ? undefined : `Add ${step.target - totalNow} more to continue`}
        >
          Continue
        </button>
        <button
          type="button"
          className={styles.rdGhostButton}
          onClick={onSkip}
        >
          Skip for now
        </button>
      </div>
    </>
  );
}

function SuggestionCard({
  rec,
  saving,
  onUse,
  onEdit,
  onSkip,
}: {
  rec: Recommendation;
  saving: boolean;
  onUse: () => void;
  onEdit: () => void;
  onSkip: () => void;
}) {
  return (
    <article className={styles.rdSuggestionCard}>
      <h4 className={styles.rdSuggestionTitle}>{rec.title}</h4>
      {rec.body ? (
        <p className={styles.rdSuggestionBody}>{rec.body}</p>
      ) : null}
      {rec.rationale ? (
        <p className={styles.rdSuggestionRationale}>{rec.rationale}</p>
      ) : null}
      <div className={styles.rdSuggestionActions}>
        <button
          type="button"
          className={styles.rdReadinessAction}
          onClick={onUse}
          disabled={saving}
        >
          Use this
        </button>
        <button
          type="button"
          className={styles.rdSecondaryButton}
          onClick={onEdit}
        >
          Edit
        </button>
        <button
          type="button"
          className={styles.rdGhostButton}
          onClick={onSkip}
        >
          Skip
        </button>
      </div>
    </article>
  );
}

// ---- Step-building & write dispatch ------------------------------

function buildSteps(gaps: InitialGaps): Step[] {
  const steps: Step[] = [];

  if (gaps.responsibilities.count < gaps.responsibilities.needed) {
    steps.push({
      kind: "responsibilities",
      question: "What does this seat own?",
      helperText:
        "Add the categories of work this seat is responsible for, beyond Lead / Track / Decide. Aim for the ones a coach would ask about first.",
      addPlaceholder: "e.g. Owns the annual budget cycle",
      initialCount: gaps.responsibilities.count,
      target: gaps.responsibilities.needed,
    });
  }
  if (gaps.outcomes.count < gaps.outcomes.needed) {
    steps.push({
      kind: "outcomes",
      question: "What are the results this seat is accountable for?",
      helperText:
        "Three measurable outcomes the seat is obsessed with delivering — the results, not the activities.",
      addPlaceholder: "e.g. Every project delivered on budget",
      initialCount: gaps.outcomes.count,
      target: gaps.outcomes.needed,
    });
  }
  for (const o of gaps.measuresNeededFor) {
    steps.push({
      kind: "measures",
      question: `What tells you this outcome is on track?`,
      helperText:
        "Pick one KPI that shows performance against this outcome. The target can be added on the metric row later.",
      addPlaceholder: "e.g. % of projects delivered on budget",
      initialCount: 0,
      target: 1,
      outcomeId: o.outcomeId,
      outcomeTitle: o.outcomeTitle,
    });
  }
  if (gaps.decisionRights.count < gaps.decisionRights.needed) {
    steps.push({
      kind: "decision_rights",
      question: "What can this seat decide without escalation?",
      helperText:
        "Precise decision rights reduce dysfunction. Name at least one — budget ceiling, hiring authority, vendor selection, etc.",
      addPlaceholder: "e.g. Approve marketing spend up to $10,000",
      initialCount: gaps.decisionRights.count,
      target: gaps.decisionRights.needed,
    });
  }
  if (gaps.competencies.count < gaps.competencies.needed) {
    steps.push({
      kind: "competencies",
      question: "What behaviors show excellence in this seat?",
      helperText:
        "Observable behaviors a manager could watch for. Three to five is the target.",
      addPlaceholder: "e.g. Runs a weekly team meeting the team looks forward to",
      initialCount: gaps.competencies.count,
      target: gaps.competencies.needed,
    });
  }
  return steps;
}

function stepKeyOf(step: Step): string {
  return step.outcomeId ? `${step.kind}:${step.outcomeId}` : step.kind;
}

function rdTargetOf(kind: StepKind): RdTarget {
  if (kind === "responsibilities") return "outcomes"; // reuse "outcomes" tone
  if (kind === "outcomes") return "outcomes";
  if (kind === "measures") return "measures";
  if (kind === "decision_rights") return "decision_rights";
  return "competencies";
}

async function writeItem(input: {
  step: Step;
  functionId: string;
  title: string;
  body: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const fd = new FormData();
  fd.set("function_id", input.functionId);
  fd.set("title", input.title);
  if (input.body) fd.set("body", input.body);
  if (input.body) fd.set("description", input.body);

  switch (input.step.kind) {
    case "responsibilities": {
      const r = await createFunctionRoleAction(undefined, fd);
      if (!r.ok) return { ok: false, message: r.message };
      return { ok: true };
    }
    case "outcomes": {
      const r = await createOutcomeAction(undefined, fd);
      if (!r.ok) return { ok: false, message: r.message };
      return { ok: true };
    }
    case "measures": {
      if (!input.step.outcomeId) {
        return { ok: false, message: "Missing outcome for this metric." };
      }
      const mfd = new FormData();
      mfd.set("outcome_id", input.step.outcomeId);
      mfd.set("description", input.title);
      mfd.set("value_type", "number");
      mfd.set("target_direction", "higher_is_better");
      mfd.set("auto_track", "on");
      const r = await createMeasureAction(undefined, mfd);
      if (!r.ok) return { ok: false, message: r.message };
      return { ok: true };
    }
    case "decision_rights": {
      const r = await createFunctionDecisionRightAction(undefined, fd);
      if (!r.ok) return { ok: false, message: r.message };
      return { ok: true };
    }
    case "competencies": {
      const r = await createFunctionCompetencyAction(undefined, fd);
      if (!r.ok) return { ok: false, message: r.message };
      return { ok: true };
    }
  }
}
