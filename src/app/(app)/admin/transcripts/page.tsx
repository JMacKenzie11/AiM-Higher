import { redirect } from "next/navigation";

// The Transcripts surface was consolidated into the Companies pages:
// platform-level Google account + unrouted queue live on
// /admin/companies; each company's sources, meetings, and aliases
// live on /admin/companies/[id]. Redirect any stale bookmark.

export default function TranscriptsRedirect() {
  redirect("/admin/companies");
}
