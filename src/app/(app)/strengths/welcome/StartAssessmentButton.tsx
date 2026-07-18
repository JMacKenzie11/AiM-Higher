"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import styles from "../strengths.module.css";

export default function StartAssessmentButton({
  userId,
  companyId,
}: {
  userId: string;
  companyId: string | null;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!companyId) {
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
