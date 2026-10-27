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
