"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { trackClient } from "@/lib/analytics/track-client";
import styles from "../strengths.module.css";

export default function StartAssessmentButton({
  userId,
  companyId,
  isSystemAdmin,
}: {
  userId: string;
  companyId: string | null;
  isSystemAdmin: boolean;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    // Sysadmins take the assessment against their own profile with a
    // null company_id (migration 0123 + RLS). Everyone else must be
    // attached to a company that has the strengths feature on.
    if (!companyId && !isSystemAdmin) {
      setError(
        "Your profile isn't attached to a company yet — ask your admin to finish setup."
      );
      return;
    }
    setStarting(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: insertError } = await supabase
      .from("strengths_assessments")
      .insert({ user_id: userId, company_id: companyId, version: 1 });
    if (insertError && !/duplicate/i.test(insertError.message)) {
      setStarting(false);
      setError("Couldn't start — try refreshing.");
      return;
    }
    trackClient("strengths_assessment_started", {
      is_system_admin: isSystemAdmin,
      has_company: Boolean(companyId),
    });
    router.push("/strengths/assessment");
  }

  return (
    <>
      <button
        type="button"
        className={styles.primaryButton}
        onClick={start}
        disabled={starting}
      >
        {starting ? "Getting things ready…" : "Start the assessment"}
      </button>
      {error ? (
        <p role="alert" className={styles.proseMuted} style={{ color: "var(--aims-danger)" }}>
          {error}
        </p>
      ) : null}
    </>
  );
}
