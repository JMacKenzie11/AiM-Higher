import "server-only";

import type { DownloadedFile, ListedFile, TranscriptProvider } from "../provider";
import type { TranscriptSource } from "@/lib/types";
import { GraphError, graphFetch, graphRequest, microsoftAccessToken } from "@/lib/connections/microsoft";

// MICROSOFT TEAMS: transcripts read straight from Microsoft, one Teams
// meeting per source (Jason, 2026-11-12). Replaces the stub that
// assumed transcripts would be dropped in a OneDrive folder.
//
// A source's folder_id is the Teams meeting's ID (Graph's onlineMeeting
// id), and folder_name its title. A recurring meeting has ONE such id
// across all its occurrences, so one source follows the weekly meeting
// for as long as the series runs, and each week's transcript arrives as
// a new transcript on that meeting.
//
// Read as the person who connected Microsoft 365 for the company
// (delegated). Microsoft lets that person read a meeting's transcripts
// when they organised it or were invited to it.
//
// What Microsoft does not offer, and so neither does this: channel
// meetings, live events, and meetings with transcription off. A
// meeting run without "Record and transcribe" simply produces nothing.

type GraphTranscript = {
  id: string;
  createdDateTime: string;
  endDateTime?: string | null;
};

type GraphPage<T> = { value: T[]; "@odata.nextLink"?: string };

type GraphMeeting = { id: string; subject?: string | null };

function meetingPath(meetingId: string) {
  return `/me/onlineMeetings/${encodeURIComponent(meetingId)}`;
}

// A transcript's "file name": the meeting's title and the day it was
// made. It becomes the meeting's placeholder title in AiMS (the
// analysis usually writes a better one), so it should read like one.
export function transcriptName(meetingTitle: string | null, createdIso: string): string {
  const day = createdIso.slice(0, 10);
  return `${meetingTitle?.trim() || "Teams meeting"} ${day}.vtt`;
}

// The new transcripts, oldest first, and the cursor to store: the
// newest creation time seen. Pure, so the cursor rule is tested
// without Microsoft.
export function newSince(
  transcripts: GraphTranscript[],
  cursor: string | null
): { fresh: GraphTranscript[]; nextCursor: string | null } {
  const fresh = transcripts
    .filter((t) => !cursor || t.createdDateTime > cursor)
    .sort((a, b) => a.createdDateTime.localeCompare(b.createdDateTime));
  const nextCursor = fresh.length > 0 ? fresh[fresh.length - 1].createdDateTime : cursor;
  return { fresh, nextCursor };
}

function friendly(err: unknown, meetingTitle: string | null): Error {
  if (err instanceof GraphError) {
    if (err.status === 404) {
      return new Error(
        `Microsoft can't find "${meetingTitle ?? "this meeting"}" for the connected account any more. It may have been deleted, or the account is no longer invited.`
      );
    }
    if (err.status === 403) {
      return new Error(
        "Microsoft refused to share this meeting's transcripts. The company's Microsoft 365 admin may need to approve AiMS HQ again, or transcripts are turned off for this organisation."
      );
    }
    return new Error(`Microsoft: ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function listNewFiles(source: TranscriptSource): Promise<{ files: ListedFile[]; nextCursor: string | null }> {
  if (!source.company_id) throw new Error("A Teams source belongs to one company.");
  const token = await microsoftAccessToken(source.company_id);
  const all: GraphTranscript[] = [];
  try {
    let next: string | undefined = `${meetingPath(source.folder_id)}/transcripts`;
    while (next) {
      const page: GraphPage<GraphTranscript> = await graphFetch<GraphPage<GraphTranscript>>(token, next);
      all.push(...page.value);
      next = page["@odata.nextLink"];
    }
  } catch (err) {
    throw friendly(err, source.folder_name);
  }
  const { fresh, nextCursor } = newSince(all, source.cursor);
  return {
    files: fresh.map((t) => ({
      fileId: t.id,
      name: transcriptName(source.folder_name, t.createdDateTime),
      modifiedAt: t.createdDateTime,
    })),
    nextCursor,
  };
}

async function downloadFile(source: TranscriptSource, fileId: string): Promise<DownloadedFile> {
  if (!source.company_id) throw new Error("A Teams source belongs to one company.");
  const token = await microsoftAccessToken(source.company_id);
  const base = `${meetingPath(source.folder_id)}/transcripts/${encodeURIComponent(fileId)}`;
  try {
    const meta = await graphFetch<GraphTranscript>(token, base);
    const name = transcriptName(source.folder_name, meta.createdDateTime);
    try {
      const res = await graphRequest(token, `${base}/content?$format=text/vtt`, "text/vtt");
      return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: "text/vtt", name };
    } catch (err) {
      // An organisation can switch off who-said-what in transcripts it
      // shares. Microsoft then refuses the VTT and offers plain text
      // with no speakers, which is still worth analysing.
      if (err instanceof GraphError && err.code === "SpeakerAttributionNotAllowed") {
        const res = await graphRequest(token, `${base}/content`, "application/vnd.microsoft.graph.transcript+text");
        return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: "text/plain", name: name.replace(/\.vtt$/, ".txt") };
      }
      throw err;
    }
  } catch (err) {
    throw friendly(err, source.folder_name);
  }
}

// Called when a meeting is connected: proves the account can reach it
// and returns its title for the row.
async function verifyFolderAccess(meetingId: string, companyId: string): Promise<{ folderName: string }> {
  const token = await microsoftAccessToken(companyId);
  try {
    const meeting = await graphFetch<GraphMeeting>(token, `${meetingPath(meetingId)}?$select=id,subject`);
    return { folderName: meeting.subject?.trim() || "Teams meeting" };
  } catch (err) {
    throw friendly(err, null);
  }
}

export const teamsProvider: TranscriptProvider = { listNewFiles, downloadFile, verifyFolderAccess };

// ---- The meeting picker ------------------------------------------

export type TeamsMeetingChoice = {
  joinUrl: string;
  subject: string;
  recurring: boolean;
  // The nearest occurrence in the window, for "Tuesdays 9:00" style
  // recognition. ISO, in UTC.
  nextOrLast: string;
};

type GraphEvent = {
  subject?: string | null;
  type?: string | null;
  seriesMasterId?: string | null;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string | null } | null;
  start?: { dateTime?: string; timeZone?: string } | null;
};

// The Teams meetings on the connected person's calendar from two weeks
// ago to four weeks ahead, one row per meeting: a weekly meeting shows
// once, however many times it falls in the window. Pure.
export function meetingChoices(events: GraphEvent[], now: Date): TeamsMeetingChoice[] {
  const byUrl = new Map<string, { subject: string; recurring: boolean; starts: string[] }>();
  for (const e of events) {
    const joinUrl = e.onlineMeeting?.joinUrl;
    if (!e.isOnlineMeeting || !joinUrl || !e.start?.dateTime) continue;
    const startIso = new Date(`${e.start.dateTime.replace(/Z?$/, "")}Z`).toISOString();
    const entry = byUrl.get(joinUrl) ?? { subject: e.subject?.trim() || "Untitled meeting", recurring: false, starts: [] };
    entry.recurring ||= Boolean(e.seriesMasterId) || e.type === "occurrence";
    entry.starts.push(startIso);
    byUrl.set(joinUrl, entry);
  }
  const nowIso = now.toISOString();
  return [...byUrl.entries()]
    .map(([joinUrl, v]) => {
      const sorted = v.starts.sort();
      const upcoming = sorted.find((s) => s >= nowIso);
      return { joinUrl, subject: v.subject, recurring: v.recurring || sorted.length > 1, nextOrLast: upcoming ?? sorted[sorted.length - 1] };
    })
    // Recurring meetings first (the weekly meeting is the usual pick),
    // then by title.
    .sort((a, b) => Number(b.recurring) - Number(a.recurring) || a.subject.localeCompare(b.subject));
}

export async function listTeamsMeetings(companyId: string, now = new Date()): Promise<TeamsMeetingChoice[]> {
  const token = await microsoftAccessToken(companyId);
  const start = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const end = new Date(now.getTime() + 28 * 86_400_000).toISOString();
  const events: GraphEvent[] = [];
  let next: string | undefined =
    `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}` +
    `&$select=subject,type,seriesMasterId,isOnlineMeeting,onlineMeeting,start&$top=200`;
  try {
    while (next) {
      const page: GraphPage<GraphEvent> = await graphFetch<GraphPage<GraphEvent>>(token, next);
      events.push(...page.value);
      next = page["@odata.nextLink"];
    }
  } catch (err) {
    throw friendly(err, null);
  }
  return meetingChoices(events, now);
}

// A calendar meeting's join link -> the Teams meeting's ID, which is
// what transcripts hang off.
export async function meetingIdForJoinUrl(companyId: string, joinUrl: string): Promise<string> {
  const token = await microsoftAccessToken(companyId);
  const filter = encodeURIComponent(`JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`);
  try {
    const page = await graphFetch<GraphPage<GraphMeeting>>(token, `/me/onlineMeetings?$filter=${filter}`);
    const id = page.value[0]?.id;
    if (!id) throw new Error("Microsoft has no Teams meeting behind that calendar entry.");
    return id;
  } catch (err) {
    throw friendly(err, null);
  }
}
