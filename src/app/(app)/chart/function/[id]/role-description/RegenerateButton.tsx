"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regenerateRoleDescriptionAction } from "@/lib/role-descriptions/regenerate-action";
import styles from "./role-description.module.css";

// Admin-only "Regenerate" pill in the RD view header. Clears the
// cached document and reloads the route so the AssembledDocument
// server component runs a fresh Sonnet call. Handy when foundation
// copy (values, purpose) changes and the auto-invalidation on chart
// entities didn't fire.

export function RegenerateButton({ functionId }: { functionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await regenerateRoleDescriptionAction(functionId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={styles.regenerateButtonWrap}>
      <button
        type="button"
        className={styles.regenerateButton}
        onClick={run}
        disabled={pending}
        title="Rebuild this role description from the current chart state"
      >
        {pending ? "Regenerating…" : "Regenerate"}
      </button>
      {error ? (
        <p role="alert" className={styles.regenerateError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
