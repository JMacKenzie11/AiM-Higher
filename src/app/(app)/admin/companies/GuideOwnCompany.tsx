"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setGuideOwnCompanyAction } from "@/lib/admin/guides-actions";
import styles from "./admin.module.css";

// The guide's own company, on their row in the AiMS Guides card: the
// coaching business they run as well as guiding clients. Saving makes
// them a member of it and its admin, so they can sit on its chart and
// own its work. System admins only, like the card.

export function GuideOwnCompany({
  guideId,
  guideName,
  companyId,
  companies,
}: {
  guideId: string;
  guideName: string;
  companyId: string | null;
  companies: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [value, setValue] = useState(companyId ?? "");
  const [saved, setSaved] = useState(companyId ?? "");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const fieldId = `own-company-${guideId}`;

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await setGuideOwnCompanyAction(guideId, value || null);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setSaved(value);
      setMessage("Saved.");
      router.refresh();
    });
  }

  return (
    <div className={styles.assignSysadminRow}>
      <label htmlFor={fieldId} className={styles.assignSysadminLabel}>
        Their own company
      </label>
      <select
        id={fieldId}
        className={styles.select}
        value={value}
        disabled={pending}
        onChange={(e) => {
          setValue(e.target.value);
          setMessage(null);
        }}
        aria-describedby={`${fieldId}-hint`}
      >
        <option value="">None</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {value !== saved ? (
        <button
          type="button"
          className={styles.ghostButton}
          onClick={save}
          disabled={pending}
          aria-label={`Save ${guideName}'s own company`}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      ) : null}
      <span id={`${fieldId}-hint`} className={styles.fieldHint}>
        They join it as its admin, so they can be on its chart and own its work.
      </span>
      {message ? (
        <span role="status" className={message === "Saved." ? styles.successMessage : styles.inlineError}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
