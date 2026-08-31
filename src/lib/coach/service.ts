import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

// Read-side helpers for the /coach surface. RLS scopes everything to
// the current admin's created_by; server helpers here just return the
// rows the caller is allowed to see.

export type CoachingContextKind = "execution" | "strengths";
// 'about' — a person on file. 'general' — Ask Aimee, no subject.
// (Historical 'self' rows were migrated to 'general' in 0105.)
export type CoachingMode = "about" | "general";

export type CoachingConversation = {
  id: string;
  company_id: string;
  // Null for general (Ask Aimee) conversations — the user brings the
  // situation. Non-null for 'about' conversations.
  subject_profile_id: string | null;
  created_by: string;
  title: string;
  archived: boolean;
  // Which module owns the coaching context — drives prompt selection
  // and person-context assembly. Defaults to 'execution' on old rows
  // (migration 0018).
  context_kind: CoachingContextKind;
  mode: CoachingMode;
  // Practices layer (migration 0132). A practice_id promotes a
  // general conversation into a guided practice session: the
  // registered practice's prompt is appended after the base coach
  // prompt, and the user's own person_context is loaded (unlike
  // vanilla general mode which loads none). partner_profile_id, if
  // set, adds a strict-allow-list partner_context block (name,
  // position, reports_to, open commitments, current-quarter
  // follow-through rate — nothing else).
  practice_id: string | null;
  partner_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CoachingMessage = {
  id: string;
  conversation_id: string;
  created_by: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ConversationWithSnippet = CoachingConversation & {
  lastMessageSnippet: string | null;
};

export async function listConversationsForSubject(
  subjectProfileId: string,
  includeArchived = false
): Promise<ConversationWithSnippet[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("coaching_conversations")
    .select("*")
    .eq("mode", "about")
    .eq("subject_profile_id", subjectProfileId)
    .order("updated_at", { ascending: false });
  if (!includeArchived) query = query.eq("archived", false);

  const { data: convos } = await query;
  const rows = (convos ?? []) as CoachingConversation[];
  if (rows.length === 0) return [];

  // One extra query to pull the last message of each conversation for
  // the snippet. v1 volumes are tiny; if this ever gets hot we can
  // move it into a view or a lateral join.
  const { data: messages } = await supabase
    .from("coaching_messages")
    .select("conversation_id, content, created_at")
    .in("conversation_id", rows.map((r) => r.id))
    .order("created_at", { ascending: false });
  const bySnippet = new Map<string, string>();
  for (const m of (messages ?? []) as Array<{
    conversation_id: string;
    content: string;
    created_at: string;
  }>) {
    if (!bySnippet.has(m.conversation_id)) {
      bySnippet.set(
        m.conversation_id,
        m.content.length > 120 ? `${m.content.slice(0, 117)}…` : m.content
      );
    }
  }

  return rows.map((r) => ({
    ...r,
    lastMessageSnippet: bySnippet.get(r.id) ?? null,
  }));
}

// General (Ask Aimee) conversations belong to their creator only. RLS
// already restricts SELECT to created_by = auth.uid(); the filter
// here is a scoping convenience so the query stays cheap even if the
// caller ever creates conversations in multiple companies.
//
// companyId, when provided, further narrows the list to the caller's
// currently active company scope — a system_admin or guide who's
// worked in two tenants will otherwise see both stacks mixed on the
// Ask Aimee landing. Pass null to skip the scope filter (regular
// members always have exactly one, so it never matters for them).
export async function listGeneralConversationsForUser(
  userId: string,
  companyId: string | null,
  includeArchived = false
): Promise<ConversationWithSnippet[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("coaching_conversations")
    .select("*")
    .eq("mode", "general")
    .eq("created_by", userId)
    .order("updated_at", { ascending: false });
  if (companyId) query = query.eq("company_id", companyId);
  if (!includeArchived) query = query.eq("archived", false);

  const { data: convos } = await query;
  const rows = (convos ?? []) as CoachingConversation[];
  if (rows.length === 0) return [];

  const { data: messages } = await supabase
    .from("coaching_messages")
    .select("conversation_id, content, created_at")
    .in("conversation_id", rows.map((r) => r.id))
    .order("created_at", { ascending: false });
  const bySnippet = new Map<string, string>();
  for (const m of (messages ?? []) as Array<{
    conversation_id: string;
    content: string;
    created_at: string;
  }>) {
    if (!bySnippet.has(m.conversation_id)) {
      bySnippet.set(
        m.conversation_id,
        m.content.length > 120 ? `${m.content.slice(0, 117)}…` : m.content
      );
    }
  }

  return rows.map((r) => ({
    ...r,
    lastMessageSnippet: bySnippet.get(r.id) ?? null,
  }));
}

export async function getConversation(
  conversationId: string
): Promise<CoachingConversation | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("coaching_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle<CoachingConversation>();
  return data ?? null;
}

// ---- Sharing ------------------------------------------------
// A conversation share grants another profile read or write access
// to a specific conversation. Sharing is same-company-only (enforced
// by RLS + a before-insert trigger in migration 0150); nothing in
// this file needs to re-check that boundary.

export type ShareAccess = "read" | "write";
export type ConversationAccess = "owner" | "write" | "read";

export type ConversationShare = {
  conversation_id: string;
  profile_id: string;
  access: ShareAccess;
  created_by: string;
  created_at: string;
};

export type ShareeSummary = {
  profile_id: string;
  full_name: string;
  avatar_url: string | null;
  access: ShareAccess;
};

// Resolves how the caller can interact with a conversation. Returns
// null when the caller has neither ownership nor a share row — that
// case should 403/404 depending on surface.
//
// One helper so every place that branches on "can I do X here?"
// speaks the same vocabulary (owner | write | read | none). The API
// route, the chat page, the share modal, and the auto-title guard
// all funnel through this.
export async function getAccessForConversation(
  conversationId: string,
  userId: string
): Promise<ConversationAccess | null> {
  const supabase = await createSupabaseServerClient();

  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, created_by")
    .eq("id", conversationId)
    .maybeSingle<{ id: string; created_by: string }>();
  if (!convo) return null;
  if (convo.created_by === userId) return "owner";

  const { data: share } = await supabase
    .from("coaching_conversation_shares")
    .select("access")
    .eq("conversation_id", conversationId)
    .eq("profile_id", userId)
    .maybeSingle<{ access: ShareAccess }>();
  if (!share) return null;
  return share.access;
}

// Full share list for a conversation, hydrated with profile
// display info so the share modal doesn't need extra round-trips
// per row. Only the owner can call this productively — RLS on
// shares SELECT admits owner + sharee (own row), so a sharee
// calling this only sees themselves, which is fine for their
// read-only view.
export async function listSharesForConversation(
  conversationId: string
): Promise<ShareeSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data: shareRows } = await supabase
    .from("coaching_conversation_shares")
    .select("profile_id, access")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const shares = (shareRows ?? []) as Array<{
    profile_id: string;
    access: ShareAccess;
  }>;
  if (shares.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", shares.map((s) => s.profile_id));
  const byId = new Map(
    ((profiles ?? []) as Array<{
      id: string;
      full_name: string;
      avatar_url: string | null;
    }>).map((p) => [p.id, p])
  );

  return shares
    .map((s) => {
      const p = byId.get(s.profile_id);
      if (!p) return null;
      return {
        profile_id: p.id,
        full_name: p.full_name,
        avatar_url: p.avatar_url,
        access: s.access,
      } satisfies ShareeSummary;
    })
    .filter((row): row is ShareeSummary => row !== null);
}

// Conversations shared TO the caller, scoped to the currently
// active company (same scoping story as listGeneralConversationsForUser
// — a system_admin or guide bouncing between tenants shouldn't see
// mixed stacks). Rows include the owner's name + avatar so the
// "Shared with you" section can render "from Jane Doe · Aug 12"
// without a second query per row.
export type SharedInboxRow = ConversationWithSnippet & {
  access: ShareAccess;
  owner_name: string;
  owner_avatar_url: string | null;
};

export async function listSharedWithMe(
  userId: string,
  companyId: string | null
): Promise<SharedInboxRow[]> {
  const supabase = await createSupabaseServerClient();

  // Two-step: pull the share rows for this user (indexed by profile_id),
  // then hydrate conversations. Simpler than a nested embed and keeps
  // the RLS story crisp — the conversations SELECT policy will admit
  // each of these because a matching share row exists.
  const { data: shareRows } = await supabase
    .from("coaching_conversation_shares")
    .select("conversation_id, access")
    .eq("profile_id", userId);
  const shares = (shareRows ?? []) as Array<{
    conversation_id: string;
    access: ShareAccess;
  }>;
  if (shares.length === 0) return [];

  const accessById = new Map(shares.map((s) => [s.conversation_id, s.access]));

  let convoQuery = supabase
    .from("coaching_conversations")
    .select("*, owner:profiles!created_by(full_name, avatar_url)")
    .in("id", shares.map((s) => s.conversation_id))
    .eq("archived", false)
    .order("updated_at", { ascending: false });
  if (companyId) convoQuery = convoQuery.eq("company_id", companyId);
  const { data: convos } = await convoQuery;
  const rows = (convos ?? []) as Array<
    CoachingConversation & {
      owner: { full_name: string; avatar_url: string | null } | null;
    }
  >;
  if (rows.length === 0) return [];

  const { data: messages } = await supabase
    .from("coaching_messages")
    .select("conversation_id, content, created_at")
    .in("conversation_id", rows.map((r) => r.id))
    .order("created_at", { ascending: false });
  const bySnippet = new Map<string, string>();
  for (const m of (messages ?? []) as Array<{
    conversation_id: string;
    content: string;
    created_at: string;
  }>) {
    if (!bySnippet.has(m.conversation_id)) {
      bySnippet.set(
        m.conversation_id,
        m.content.length > 120 ? `${m.content.slice(0, 117)}…` : m.content
      );
    }
  }

  return rows.map((r) => {
    const { owner, ...convo } = r;
    return {
      ...convo,
      lastMessageSnippet: bySnippet.get(r.id) ?? null,
      access: accessById.get(r.id) ?? "read",
      owner_name: owner?.full_name ?? "Someone",
      owner_avatar_url: owner?.avatar_url ?? null,
    };
  });
}

// Candidate people for the share modal: active members of the
// conversation's company, minus the owner and anyone already
// shared with. Kept minimal — the modal only needs id/name/avatar
// for the autocomplete list.
export type ShareCandidate = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  position: string | null;
};

export async function listShareCandidatesForConversation(
  conversationId: string
): Promise<ShareCandidate[]> {
  const supabase = await createSupabaseServerClient();

  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, company_id, created_by")
    .eq("id", conversationId)
    .maybeSingle<{ id: string; company_id: string; created_by: string }>();
  if (!convo) return [];

  const { data: shareRows } = await supabase
    .from("coaching_conversation_shares")
    .select("profile_id")
    .eq("conversation_id", conversationId);
  const alreadyShared = new Set(
    ((shareRows ?? []) as Array<{ profile_id: string }>).map((r) => r.profile_id)
  );
  alreadyShared.add(convo.created_by);

  // Two disjoint sources of candidates, unioned:
  //   1. Regular members of the conversation's company — profiles
  //      whose company_id matches.
  //   2. aims_guides assigned to the conversation's company — their
  //      company_id is null, so they don't match #1; membership is
  //      derived from guide_assignments. Per the platform-wide
  //      "guide = company_admin on assigned companies" rule they
  //      belong in this picker too.
  const [
    { data: members },
    { data: assignments },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, avatar_url, position")
      .eq("company_id", convo.company_id)
      .eq("status", "active")
      .order("full_name", { ascending: true }),
    supabase
      .from("guide_assignments")
      .select("guide_id")
      .eq("company_id", convo.company_id),
  ]);

  const byId = new Map<string, ShareCandidate>();
  for (const p of (members ?? []) as ShareCandidate[]) {
    byId.set(p.id, p);
  }

  // Second round-trip for the assigned-guide (or sysadmin) profiles.
  // Kept split from the embed pattern (which supabase-js types as an
  // array on to-one FKs) so the shape is unambiguous and doesn't
  // need an unknown cast.
  const guideIds = ((assignments ?? []) as Array<{ guide_id: string }>).map(
    (a) => a.guide_id
  );
  if (guideIds.length > 0) {
    const { data: guides } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, position, status, role")
      .in("id", guideIds)
      .eq("status", "active");
    const guideRows = (guides ?? []) as Array<{
      id: string;
      full_name: string;
      avatar_url: string | null;
      position: string | null;
      status: "active";
      role: "system_admin" | "company_admin" | "team_member" | "aims_guide";
    }>;
    for (const g of guideRows) {
      // Members list wins on the (unlikely) tie so a guide who's
      // also a company member — future case, not today — shows once.
      if (!byId.has(g.id)) {
        // Prefer the profile's own position label when set; fall
        // back to a role-accurate hint (sysadmins carrying a
        // caseload showed as "AiMS Guide" before — misleading for
        // a leader who knows the difference).
        const fallbackLabel =
          g.role === "system_admin" ? "System admin" : "AiMS Guide";
        byId.set(g.id, {
          id: g.id,
          full_name: g.full_name,
          avatar_url: g.avatar_url,
          position: g.position ?? fallbackLabel,
        });
      }
    }
  }

  return Array.from(byId.values())
    .filter((p) => !alreadyShared.has(p.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

// Sender display info for a set of message authors. Used by the
// chat view to render "name + avatar" attribution on user bubbles
// once a thread has any shares. Returns a Map keyed by profile id
// so the caller can look up each message.created_by in O(1).
export async function getMessageSenders(
  profileIds: readonly string[]
): Promise<Map<string, { full_name: string; avatar_url: string | null }>> {
  if (profileIds.length === 0) return new Map();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", profileIds);
  const rows = (data ?? []) as Array<{
    id: string;
    full_name: string;
    avatar_url: string | null;
  }>;
  return new Map(
    rows.map((r) => [r.id, { full_name: r.full_name, avatar_url: r.avatar_url }])
  );
}

export async function getMessages(
  conversationId: string
): Promise<CoachingMessage[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("coaching_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return (data ?? []) as CoachingMessage[];
}
