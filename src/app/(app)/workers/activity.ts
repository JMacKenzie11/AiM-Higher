import type { RunStatus, WorkerRun } from "@/lib/workers/types";

// The Activity feed on /workers (0303): one line per task, newest first,
// grouped by day in Toronto time: what happened, and the latest thing
// the worker said or did.

export type ActivityItem = {
  runId: string;
  workerId: string;
  workerName: string;
  event: string;
  detail: string;
  at: string;
  status: RunStatus;
};

const EVENT: Record<RunStatus, string> = {
  queued: "Started",
  running: "Working",
  done: "Finished",
  failed: "Stopped with a problem",
  stopped: "Stopped",
};

function firstLine(text: string | null): string {
  const line = (text ?? "").split("\n").map((l) => l.trim()).find((l) => l && !/^[|#-]+$/.test(l.replace(/\s/g, ""))) ?? "";
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

export function activityItem(run: WorkerRun, workerName: string, latestStep: string | null): ActivityItem {
  const detail =
    run.status === "done"
      ? firstLine(run.result)
      : run.status === "failed"
        ? firstLine(run.error)
        : run.status === "stopped"
          ? "You stopped it."
          : firstLine(latestStep) || "Getting started";
  return {
    runId: run.id,
    workerId: run.worker_id,
    workerName,
    event: EVENT[run.status],
    detail,
    at: run.finished_at ?? run.started_at ?? run.created_at,
    status: run.status,
  };
}

const ZONE = "America/Toronto";

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: ZONE });
}

export function dayLabel(iso: string, now = new Date()): string {
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return "Today";
  if (key === dayKey(new Date(now.getTime() - 86_400_000).toISOString())) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-US", { timeZone: ZONE, weekday: "long", month: "long", day: "numeric" });
}

export function groupByDay(items: ActivityItem[], now = new Date()): Array<{ label: string; items: ActivityItem[] }> {
  const groups: Array<{ label: string; items: ActivityItem[] }> = [];
  for (const item of [...items].sort((a, b) => b.at.localeCompare(a.at))) {
    const label = dayLabel(item.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

// Midnight today in Toronto, as an instant, for "spent today".
export function startOfTodayIso(now = new Date()): string {
  const [y, m, d] = dayKey(now.toISOString()).split("-").map(Number);
  // Toronto is UTC-4 or UTC-5: try both and keep the one that is
  // midnight there.
  for (const offset of [4, 5]) {
    const guess = new Date(Date.UTC(y, m - 1, d, offset));
    const there = guess.toLocaleTimeString("en-GB", { timeZone: ZONE, hour12: false });
    if (there.startsWith("00:00")) return guess.toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d, 5)).toISOString();
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
