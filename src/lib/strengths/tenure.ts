// Turn a position_start_date (YYYY-MM-DD) into a plain-language tenure phrase
// suitable for embedding in a coaching or results prompt.
//
// Returns null if the input is missing or unparseable, so the caller can omit
// the phrase entirely rather than saying something misleading.
export function tenurePhrase(
  startDate: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;

  const months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth()) -
    (now.getDate() < start.getDate() ? 1 : 0);

  if (months < 0) return null;
  if (months < 1) return "less than a month in the seat";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} in the seat`;

  const years = Math.floor(months / 12);
  const remaining = months % 12;
  if (remaining === 0) {
    return `${years} year${years === 1 ? "" : "s"} in the seat`;
  }
  return `${years} year${years === 1 ? "" : "s"} and ${remaining} month${remaining === 1 ? "" : "s"} in the seat`;
}
