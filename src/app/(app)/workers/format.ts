// How the worker pages write times and costs.

export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function duration(startIso: string | null, endIso: string | null): string | null {
  if (!startIso) return null;
  const ms = (endIso ? new Date(endIso).getTime() : Date.now()) - new Date(startIso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} seconds` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

// Cents to four places, shown as dollars to the cent, or "under 1¢".
export function cost(cents: number): string {
  if (cents <= 0) return "$0.00";
  if (cents < 1) return "under 1¢";
  return `$${(cents / 100).toFixed(2)}`;
}

// "41 min ago", "3 hours ago", "2 days ago".
export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

// How long a question has left of its day: "23 hours", "40 min".
export function expiresIn(askedAt: string, hours: number, now = Date.now()): string {
  const left = Math.max(0, new Date(askedAt).getTime() + hours * 3_600_000 - now);
  const min = Math.round(left / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
}
