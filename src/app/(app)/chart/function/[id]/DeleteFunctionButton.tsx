"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteFunctionAction } from "@/lib/chart/actions";
import styles from "../../chart.module.css";

// Hard-delete a function. Confirms first because the cascade takes
// every sub-function, outcome, measure, and weekly entry with it.
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

  function handleDelete() {
    const extra = hasChildren
      ? " Every sub-function, outcome, measure, and recorded value goes with it."
      : " Its outcomes, measures, and recorded values go with it.";
    if (!confirm(`Delete "${functionTitle}"?${extra} This cannot be undone.`)) {
      return;
    }
    startTransition(async () => {
      const result = await deleteFunctionAction(functionId);
      if (!result.ok) {
        alert(result.message);
        return;
      }
      router.push("/chart");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={pending}
      className={styles.deleteFunctionButton}
    >
      {pending ? "Deleting…" : "Delete function"}
    </button>
  );
}
