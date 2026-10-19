"use client";

import { useEffect, useState } from "react";
import styles from "./meeting.module.css";

// Minutes since the meeting opened, for whoever is running it.
export function MeetingTimer({ started }: { started: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // Nothing on the server render, so the first paint cannot disagree
  // with the browser's clock.
  if (now === null) return <span className={styles.timer} />;
  const minutes = Math.max(0, Math.floor((now - Date.parse(started)) / 60_000));
  return (
    <span className={styles.timer} aria-label={`${minutes} minutes in`}>
      {minutes} min
    </span>
  );
}
