// The people in scope, typed or pasted as a list on the Kickoff step:
// one person per line, name first, then role, with an email anywhere
// on the line. Commas or tabs separate them, so a column copied from a
// spreadsheet works as well as a typed list.
export type ParticipantLine = { name: string; role_title: string | null; email: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseParticipantLines(raw: string): ParticipantLine[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.split(/\t|,/).map((s) => s.trim()).filter(Boolean))
    .filter((parts) => parts.length > 0)
    .map((parts) => {
      const mail = parts.find((p) => EMAIL.test(p)) ?? null;
      const rest = parts.filter((p) => p !== mail);
      return { name: (rest[0] ?? mail ?? "").slice(0, 200), role_title: rest[1]?.slice(0, 200) ?? null, email: mail };
    })
    .filter((p) => p.name);
}
