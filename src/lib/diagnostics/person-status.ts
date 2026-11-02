// The Status chip on a client's People who can sign in.

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Supabase's email link lasts 24 hours (as /people's "Expired").
const INVITE_LINK_EXPIRY_MS = 86400 * 1000;

// Where a person stands: signed in, waiting on a live invite, waiting
// on a dead one, never invited, or switched off.
export function personStatus(person: { status: string; invited_at: string | null }, now = Date.now()): { label: string; tone: "good" | "waiting" | "bad" | "muted"; title: string } {
  if (person.status === "active") return { label: "Active", tone: "good", title: "Accepted the invite and signed in" };
  if (person.status === "inactive") return { label: "Inactive", tone: "muted", title: "Their account is switched off" };
  if (!person.invited_at) return { label: "Not invited", tone: "muted", title: "No invite has gone out yet" };
  if (now - new Date(person.invited_at).getTime() > INVITE_LINK_EXPIRY_MS)
    return { label: "Invite expired", tone: "bad", title: `Invited ${day(person.invited_at)}. The link has expired, so send it again.` };
  return { label: "Invited", tone: "waiting", title: `Invited ${day(person.invited_at)}, not signed in yet` };
}

