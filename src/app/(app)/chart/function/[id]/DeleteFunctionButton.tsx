"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteFunctionAction } from "@/lib/chart/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import styles from "../../chart.module.css";

// Hard-delete a function. Confirms first because the cascade takes
// every sub-function, outcome, measure, and weekly entry with it.
// Uses the branded ConfirmDialog so the confirmation doesn't blow up
// as a native modal in a shared meeting screen; failures inline
// instead of via an alert() that would freeze the whole window.
export function DeleteFunctionButton({
  functionId,
  functionTitle,
  hasChildren,
}: {
  functionId: string;
  functionTitle: string;
  hasChildren: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setConfirming(false);
    setError(null);
    startTransition(async () => {
      const result = await deleteFunctionAction(functionId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push("/chart");
      router.refresh();
    });
  }

  const cascadeCopy = hasChildren
    ? "Every sub-function, outcome, measure, and recorded value goes with it. This can't be undone."
    : "Its outcomes, measures, and recorded values go with it. This can't be undone.";

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        className={styles.deleteFunctionButton}
      >
        {pending ? "Deleting…" : "Delete function"}
      </button>
      {error ? (
        <span
          role="alert"
          style={{ color: "var(--aims-danger)", fontSize: 13, marginLeft: 12 }}
        >
          {error}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={`Delete "${functionTitle}"?`}
        message={cascadeCopy}
        confirmLabel="Delete function"
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
    </>
  );
}
