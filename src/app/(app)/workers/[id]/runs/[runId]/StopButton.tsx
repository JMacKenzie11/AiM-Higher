"use client";

import { useTransition } from "react";
import { stopRunAction } from "@/lib/workers/actions";
import styles from "../../../workers.module.css";

export function StopButton({ workerId, runId }: { workerId: string; runId: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className={styles.secondary} disabled={pending} onClick={() => start(() => stopRunAction(workerId, runId))}>
      {pending ? "Stopping…" : "Stop"}
    </button>
  );
}
