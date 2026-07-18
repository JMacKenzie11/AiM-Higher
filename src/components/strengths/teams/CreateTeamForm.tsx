"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MISSION_LABELS,
  MISSION_BLURBS,
} from "@/lib/strengths/team-labels";
import type { MissionType } from "@/lib/strengths/team-scoring";
import styles from "@/app/(app)/strengths/strengths.module.css";

const MISSION_ORDER: MissionType[] = [
  "launch",
  "stabilize",
  "turnaround",
  "growth",
  "general",
];

export default function CreateTeamForm({
  lockedCompanyId,
  companies,
}: {
  lockedCompanyId: string | null;
  companies: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mission, setMission] = useState<MissionType>("launch");
  const [notes, setNotes] = useState("");
  const [companyId, setCompanyId] = useState(
    lockedCompanyId ?? companies[0]?.id ?? "",
  );
  const [status, setStatus] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        mission_type: mission,
        mission_notes: notes,
        company_id: companyId || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't create the team.");
      setStatus("idle");
      return;
    }
    const data = (await res.json()) as { id: string };
    router.push(`/strengths/teams/${data.id}`);
  }

  const showCompanyField =
    lockedCompanyId === null && companies.length > 0;

  return (
    <form onSubmit={submit} className={styles.formGrid}>
      <label className={styles.formField}>
        <span className={styles.fieldLabel}>Team name</span>
        <input
          className={styles.input}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Q3 growth pod"
          required
        />
      </label>

      {showCompanyField ? (
        <label className={styles.formField}>
          <span className={styles.fieldLabel}>Company</span>
          <select
            className={styles.input}
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            required
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.fieldLabel}>Mission</span>
        <select
          className={styles.input}
          value={mission}
          onChange={(e) => setMission(e.target.value as MissionType)}
        >
          {MISSION_ORDER.map((m) => (
            <option key={m} value={m}>
              {MISSION_LABELS[m]}. {MISSION_BLURBS[m]}
            </option>
          ))}
        </select>
      </label>

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.fieldLabel}>Mission notes (optional)</span>
        <textarea
          className={styles.input}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything specific about what this team is for."
        />
      </label>

      {error ? <p className={styles.fieldError}>{error}</p> : null}

      <div className={styles.formFieldFull}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={status === "sending"}
        >
          {status === "sending" ? "Creating…" : "Create team"}
        </button>
      </div>
    </form>
  );
}
