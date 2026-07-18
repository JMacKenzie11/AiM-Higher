"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function StartAssessmentButton({
  userId,
  companyId,
}: {
  userId: string;
  companyId: string | null;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  async function start() {
    if (!companyId) {
      alert("Your profile isn't fully set up yet. Reach out to your admin.");
      return;
    }
    setStarting(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from("strengths_assessments")
      .insert({ user_id: userId, company_id: companyId, version: 1 });
    if (error && !/duplicate/i.test(error.message)) {
      setStarting(false);
      alert("Couldn't start. Try refreshing.");
      return;
    }
    router.push("/assessment");
  }

  return (
    <button
      className="btn btn-primary lg"
      onClick={start}
      disabled={starting}
      style={{ alignSelf: "flex-start" }}
    >
      {starting ? "Getting things ready..." : "Start the assessment"}
    </button>
  );
}
