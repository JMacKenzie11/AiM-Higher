// Dates on the diagnostic pages, written out for people.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso: string | null): string {
  if (!iso) return "Not set";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// "In 5 days", "Today", "3 days ago", from a YYYY-MM-DD readout date.
export function daysTo(iso: string | null, todayIso: string): string {
  if (!iso) return "Not set";
  const days = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 0) return `In ${days} days`;
  return days === -1 ? "Yesterday" : `${-days} days ago`;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
