import "server-only";

import { addDays, lastFriday, thisFriday, todayInTimezone, formatShortDate } from "@/lib/dates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { getCommitmentsPageData, type CommitmentWithMeta } from "@/lib/commitments/service";
import { summarizeFollowThrough, type FollowThroughSummary } from "@/lib/commitments/follow-through";
import { vimeoEmbedUrl } from "@/lib/recap-video/vimeo";
import { resolveVideoThumbnail, shareUrlFor } from "@/lib/classroom/video-thumbnail";
import { honorRoll, type HonorRoll, type LastWeekRow } from "./honor-roll";

// WHAT THE DASHBOARD'S THIS WEEK TAB SHOWS (Jason, 2026-11-20). Read as the person, so every
// read is what their own access rules allow, the same as the pages these
// numbers come from.
//
//   recap         the newest recap video for the company (0328)
//   lastWeek      commitments due in the week that ended last Friday:
//                 Follow-Through Rate by the product's one rule
//                 (follow-through.ts) and the honor roll
//   wins          what is done so far this week (due by this Friday and
//                 kept), by person: the strengths-based tile that took
//                 the past-due one's place (Jason, 2026-11-21)
//   open          open commitments due by the end of next week, and
//                 everything open past its date, as the Commitments page
//                 lists them, so the same drawer opens on them

export type WelcomeRecap = {
  embedUrl: string;
  // The video's cover image (Vimeo oEmbed), shown over the player when
  // the video has finished. Null when Vimeo does not answer.
  poster: string | null;
  savedAt: string;
  isNew: boolean;
  meeting: { title: string; date: string } | null;
};

export type WelcomeData = {
  recap: WelcomeRecap | null;
  latestMeeting: { title: string; date: string } | null;
  lastWeek: { weekEnding: string; followThrough: FollowThroughSummary; honor: HonorRoll };
  wins: WeekWins;
  open: CommitmentWithMeta[];
  todayIso: string;
  thisFriday: string;
  horizon: string;
  roster: Array<{ id: string; full_name: string }>;
  priorityOptions: Array<{ id: string; title: string }>;
  functionalAreaOptions: Array<{ id: string; title: string }>;
};

export type WeekWins = { total: number; people: Array<{ name: string; n: number }> };

const NEW_FOR_DAYS = 7;
const KEPT = ["kept_on_time", "kept_late"];

export async function getWelcomeData(companyId: string, viewerId: string, timezone: string): Promise<WelcomeData> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const today = todayInTimezone(timezone).iso;
  const friday = thisFriday(timezone);
  const weekEnding = lastFriday(timezone);
  const horizon = addDays(friday, 7);

  const [videoRes, meetingRes, lastRes, occRes, page, winRes, winOccRes] = await Promise.all([
    db
      .from("recap_videos")
      .select("vimeo_id, vimeo_hash, created_at, meeting:meetings(meeting_title, created_at)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1),
    db
      .from("meetings")
      .select("meeting_title, created_at")
      .eq("company_id", companyId)
      .eq("kind", "team")
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1),
    db
      .from("commitments")
      .select("owner_id, status, due_date, resolved_by_profile_id")
      .eq("company_id", companyId)
      .eq("week_ending", weekEnding)
      .is("deleted_at", null)
      .is("parked_at", null),
    db
      .from("commitment_occurrences")
      .select(
        "status, resolved_by_profile_id, commitments!inner(owner_id, company_id, deleted_at, parked_at)"
      )
      .eq("week_ending", weekEnding)
      .eq("commitments.company_id", companyId)
      .is("commitments.deleted_at", null)
      .is("commitments.parked_at", null),
    getCommitmentsPageData(companyId, viewerId, { owner: "all", status: "all", type: "all" }),
    db
      .from("commitments")
      .select("owner_id")
      .eq("company_id", companyId)
      .eq("week_ending", friday)
      .in("status", KEPT)
      .is("deleted_at", null)
      .is("parked_at", null),
    db
      .from("commitment_occurrences")
      .select("commitments!inner(owner_id, company_id, deleted_at, parked_at)")
      .eq("week_ending", friday)
      .in("status", KEPT)
      .eq("commitments.company_id", companyId)
      .is("commitments.deleted_at", null)
      .is("commitments.parked_at", null),
  ]);
  for (const r of [videoRes, meetingRes, lastRes, occRes, winRes, winOccRes]) {
    if (r.error) throw new Error(`welcome read failed: ${r.error.code ?? ""} ${r.error.message}`);
  }

  type MeetingRef = { meeting_title: string | null; created_at: string } | null;
  const asMeeting = (m: MeetingRef) =>
    m ? { title: m.meeting_title?.trim() || "Leadership meeting", date: formatShortDate(m.created_at.slice(0, 10)) } : null;

  const video = (videoRes.data ?? [])[0] as unknown as
    | { vimeo_id: string; vimeo_hash: string | null; created_at: string; meeting: MeetingRef }
    | undefined;
  const recap: WelcomeRecap | null = video
    ? {
        embedUrl: vimeoEmbedUrl({ id: video.vimeo_id, hash: video.vimeo_hash }),
        poster: await recapPoster(video.vimeo_id, video.vimeo_hash),
        savedAt: video.created_at,
        isNew: Date.now() - new Date(video.created_at).getTime() < NEW_FOR_DAYS * 86_400_000,
        meeting: asMeeting(video.meeting),
      }
    : null;

  const lastRows = (lastRes.data ?? []) as unknown as Array<{
    owner_id: string | null;
    status: string;
    due_date: string | null;
    resolved_by_profile_id: string | null;
  }>;
  const occRows = (occRes.data ?? []) as unknown as Array<{
    status: string;
    resolved_by_profile_id: string | null;
    commitments: { owner_id: string | null };
  }>;

  const followThrough = summarizeFollowThrough(
    [...lastRows.map((r) => ({ status: r.status, due_date: r.due_date })), ...occRows.map((o) => ({ status: o.status, due_date: null }))],
    today
  );
  // Owners' names: the roster has everyone who can be assigned work;
  // anyone else (someone since deactivated) is read by id.
  const names = new Map<string, string>(page.roster.map((p) => [p.id, p.full_name ?? ""]));
  const owned = [
    ...lastRows.map((r) => ({ owner_id: r.owner_id, status: r.status, by: r.resolved_by_profile_id })),
    ...occRows.map((o) => ({ owner_id: o.commitments.owner_id, status: o.status, by: o.resolved_by_profile_id })),
  ].filter((r): r is { owner_id: string; status: string; by: string | null } => Boolean(r.owner_id));
  const winOwners = [
    ...((winRes.data ?? []) as Array<{ owner_id: string | null }>).map((r) => r.owner_id),
    ...((winOccRes.data ?? []) as unknown as Array<{ commitments: { owner_id: string | null } }>).map((o) => o.commitments.owner_id),
  ];
  const unnamed = [...new Set([...owned.map((r) => r.owner_id), ...winOwners.filter((id): id is string => Boolean(id))])].filter((id) => !names.has(id));
  if (unnamed.length > 0) {
    const { data } = await db.from("profiles").select("id, full_name").in("id", unnamed);
    for (const p of (data ?? []) as Array<{ id: string; full_name: string | null }>) names.set(p.id, p.full_name ?? "");
  }
  const honorRows: LastWeekRow[] = owned.map((r) => ({
    owner_id: r.owner_id,
    owner_name: names.get(r.owner_id)?.trim() || "Someone",
    status: r.status,
    resolved_by_profile_id: r.by,
  }));

  const winCounts = new Map<string, number>();
  for (const id of winOwners) {
    const name = (id ? names.get(id)?.trim() : "") || "Unassigned";
    winCounts.set(name, (winCounts.get(name) ?? 0) + 1);
  }
  const wins: WeekWins = {
    total: winOwners.length,
    people: [...winCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => ({ name, n })),
  };

  const open = [...page.mainList, ...page.futureList]
    .filter((c) => c.status === "open" && c.due_date <= horizon)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || (a.owner?.full_name ?? "").localeCompare(b.owner?.full_name ?? ""));

  return {
    recap,
    latestMeeting: asMeeting(((meetingRes.data ?? [])[0] as MeetingRef | undefined) ?? null),
    lastWeek: { weekEnding, followThrough, honor: honorRoll(honorRows) },
    wins,
    open,
    todayIso: today,
    thisFriday: friday,
    horizon,
    roster: page.roster.map((p) => ({ id: p.id, full_name: p.full_name })),
    priorityOptions: page.priorityOptions,
    functionalAreaOptions: page.functionalAreaOptions,
  };
}

// The recap's cover image, from Vimeo's oEmbed (the same resolver the
// Classroom uses, cached a day per video). Only it knows an unlisted
// video's cover. Null on any failure: the tile then shows its own dark
// background behind the play button.
async function recapPoster(id: string, hash: string | null): Promise<string | null> {
  const url = shareUrlFor("vimeo", id, hash);
  return url ? resolveVideoThumbnail(url) : null;
}
