import { redirect } from "next/navigation";

// The meeting analysis surface moved to /leadership/meetings/[id].
// Keep this route as a permanent redirect so any bookmarks or
// meeting-scoped links from prior weeks land on the new home.

type PageProps = { params: Promise<{ id: string }> };

export default async function LegacyMeetingRedirect({ params }: PageProps) {
  const { id } = await params;
  redirect(`/leadership/meetings/${id}`);
}
