import "server-only";

import { aiAppsPromptBlock } from "@/lib/ai-apps/aimee";
import { currentHelpViewer, helpFeaturesFor, loadAllHelpFor } from "@/lib/help/loader";
import { type SessionProfile } from "@/lib/auth/current-user";
import { loadSystemPrompt } from "@/lib/coach/turn/prompt";
import { resolvePracticeTools } from "@/lib/coach/turn/practice-tools";
import { buildMessages } from "@/lib/coach/turn/messages";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildCoachContext } from "@/lib/coach/context";
import { vividVisionKeepBlock, writesVividVision } from "@/lib/foundation/vivid-vision-keep";
import { googleDocsConfigured } from "@/lib/google-docs/config";
import { buildCoachTools } from "@/lib/coach/tools";
import { makePersonRecordTool } from "@/lib/coach/person-tool";
import { formatHelpIndex, helpIndexFor } from "@/lib/help/search";
import { makeSearchHelpTool } from "@/lib/help/tool";
import { PANEL_PROMPT_BLOCK, recordPanelEvent } from "@/lib/aimee/panel";
import { handoffBlock, offerableSessions, sessionOfferPromptBlock } from "@/lib/aimee/session-offers";
import { type CheckedTurn } from "@/lib/aimee/voice-check";
import { describePageContext, parsePageContext } from "@/lib/aimee/page-context";
import { getCompanyFeatures, type ModuleFeature } from "@/lib/subscriptions/service";
import type { resolveAgent } from "@/lib/practices/resolve";
import { type AgentRuntimeConfig } from "@/lib/practices/version-config";
import { type CoachingConversation, type CoachingMessage } from "@/lib/coach/service";

// The coach model unless the agent's pinned version names one, or
// ANTHROPIC_COACH_MODEL overrides it.
const DEFAULT_MODEL = "claude-sonnet-5";

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// EVERYTHING A TURN IS SENT, WORKED OUT BEFORE THE MODEL IS ASKED: the
// model, the system prompt (cached), the messages with this turn's
// context on the latest one, the tools, and whether the reply is held
// back and checked before the person sees it. The route keeps the
// request, the saves and the stream.
export async function prepareTurn(args: {
  convo: CoachingConversation;
  session: { profile: SessionProfile };
  supabase: Db;
  access: string | null;
  practice: Awaited<ReturnType<typeof resolveAgent>>;
  agentConfig: AgentRuntimeConfig | null;
  history: Array<Pick<CoachingMessage, "role" | "content">>;
  isGenerateOpener: boolean;
  pageContext: unknown;
}) {
  const { convo, session, supabase, access, practice, agentConfig, history, isGenerateOpener } = args;
  // Build context. In general mode (Ask Aimee) there is no subject,
  // so person / strengths context are absent and the system prompt
  // gets an Aimee preamble. In about mode the standard leadership
  // prompt runs against subject-scoped context. Practice sessions
  // (practice_id set) load the participant's own person_context and,
  // if a partner is named, a strict-allow-list partner_context.

  // A published version may name its own model; otherwise the env
  // override, otherwise the product default. Version first because
  // it is the most specific and the most deliberate: somebody chose
  // it for this agent and wrote a publish note saying why.
  const model =
    agentConfig?.model || process.env.ANTHROPIC_COACH_MODEL || DEFAULT_MODEL;
  // PLAIN AIMEE KNOWS THE APP: the pages this person can open (in the
  // system prompt, so it caches with it) and search_help, from the
  // session's own role and the company's features, never the request.
  // Agents keep their own focus. A panel conversation (0240, read from
  // the row) adds the panel block and, for plain Aimee, the page.
  const plainAimee = convo.mode === "general" && !practice;
  const fromPanel = convo.origin === "panel";
  // ONE SETUP, RUN TOGETHER (2026-11-14). These ran one after another,
  // and React's cache() does not memoise in a route handler, so the
  // help viewer signed the person in three or four times a turn and
  // the help files were read two or three times. The viewer and the
  // docs are read once and shared, and independent reads overlap.
  const viewerRead = plainAimee ? currentHelpViewer(session) : null;
  const helpDocs = viewerRead
    ? viewerRead.then((viewer) => loadAllHelpFor(session.profile.role, viewer))
    : undefined;
  // Awaited below; this only keeps an early failure from going unhandled.
  helpDocs?.catch(() => {});
  const [context, helpFeatures, viewer, offers, basePrompt] = await Promise.all([
    buildCoachContext({
      companyId: convo.company_id,
      subjectProfileId: convo.subject_profile_id,
      currentAdminName: session.profile.full_name,
      currentAdminProfileId: session.profile.id,
      currentAdminRole: session.profile.role,
      currentAdminCompanyId: session.profile.company_id,
      currentAdminReportsTo: session.profile.reports_to ?? null,
      contextKind: convo.context_kind,
      practiceId: convo.practice_id,
      partnerProfileId: convo.partner_profile_id,
    }),
    plainAimee ? getCompanyFeatures(convo.company_id) : Promise.resolve([] as ModuleFeature[]),
    viewerRead,
    // Guided sessions are offered to the conversation's owner only.
    plainAimee && access === "owner"
      ? offerableSessions({ db: supabase, profile: session.profile, companyId: convo.company_id })
      : Promise.resolve(null),
    loadSystemPrompt(convo.mode, agentConfig),
  ]);
  // The page beside the panel: path and record id only from the
  // browser, checked against this person's role and features, the
  // record read with THIS session's client (lib/aimee/page-context.ts).
  const [helpIndex, pageBlock] = await Promise.all([
    plainAimee
      ? helpIndexFor(session.profile.role, helpFeatures, convo.company_id, helpDocs)
      : Promise.resolve(null),
    fromPanel && plainAimee
      ? describePageContext(supabase, parsePageContext(args.pageContext), session.profile.role, helpFeatures, helpDocs)
      : Promise.resolve(""),
  ]);
  const helpIndexBlock = helpIndex ? formatHelpIndex(helpIndex, session.profile.role) : "";
  const offerBlock = offers ? sessionOfferPromptBlock(offers) : "";
  // AI APPS (Jason, 2026-10-14): by the same rule as the help and the
  // How to connect drawer (lib/ai-apps/aimee.ts). Plain Aimee only.
  const aiAppsBlock = viewer ? aiAppsPromptBlock(helpFeaturesFor(session.profile.role, viewer)) : "";
  // THE VIVID VISION CARD'S BUTTONS (2026-11-03): from the same
  // setting the card reads, for any agent whose prompt writes the
  // card, so the agent never offers a button the card does not have.
  const vividVisionBlock =
    agentConfig && writesVividVision(agentConfig.prompt) ? vividVisionKeepBlock({ googleDocs: googleDocsConfigured() }) : "";
  const systemPromptText =
    basePrompt +
    (vividVisionBlock ? `\n\n${vividVisionBlock}` : "") +
    (helpIndexBlock ? `\n\n${helpIndexBlock}` : "") +
    (aiAppsBlock ? `\n\n${aiAppsBlock}` : "") +
    (offerBlock ? `\n\n${offerBlock}` : "") +
    (fromPanel ? `\n\n${PANEL_PROMPT_BLOCK}` : "");

  const personBlock = context.personContext ? `${context.personContext}\n\n` : "";
  const partnerBlock = context.partnerContext ? `${context.partnerContext}\n\n` : "";
  const strengthsBlock = context.strengthsContext ? `${context.strengthsContext}\n\n` : "";
  // Memory rides LAST among the data blocks, immediately before the
  // coaching context that tells the model how to use it. Absent
  // entirely when there is nothing to recall — an empty
  // <coach_memory> block is a prompt saying "there is a memory system
  // and it is empty", which invites apologising for it.
  const memoryBlock = context.memoryContext ? `${context.memoryContext}\n\n` : "";
  // WHAT IS OPEN BESIDE THE PANEL (Step 4). A panel conversation's
  // request names the page and, for a drawer, a record's pattern and
  // id; nothing else from the browser is used. The page is checked
  // against this person's role and features, and the record is loaded
  // with THIS session's client, so RLS decides what Aimee may read
  // (lib/aimee/page-context.ts). Rides on the latest user turn, which
  // is the only turn it describes.
  // A session started from Aimee's offer: the summary the person
  // accepted, on every turn, so the session never asks them to repeat
  // it (0262).
  const handoffText = convo.handoff_summary ? `${handoffBlock(convo.handoff_summary)}\n\n` : "";
  const userTurnPrefix = `${context.companyContext}\n\n${personBlock}${partnerBlock}${strengthsBlock}${memoryBlock}${context.coachingContext}\n\n${handoffText}${pageBlock ? `${pageBlock}\n\n` : ""}`;
  const messages = buildMessages(history, userTurnPrefix);

  // Tools: plain Aimee adds search_help and person_record; every
  // conversation gets memory, history, live-state and about_aims;
  // subject-scoped tools (strengths) only in about mode; classroom when
  // the feature is on (buildCoachTools); an agent adds its own pinned
  // tools. Duplicates are dropped by name.
  const tools = [
    ...(plainAimee
      ? [
          makeSearchHelpTool({
            role: session.profile.role,
            features: helpFeatures,
            companyId: convo.company_id,
            // Counted, never the query (lib/aimee/panel.ts).
            onSearch: (found) =>
              void recordPanelEvent(supabase, {
                companyId: convo.company_id,
                profileId: session.profile.id,
                role: session.profile.role,
                kind: "help_search",
                found,
              }),
          }),
          // A named person's record, read as this session (open data
          // phase F, lib/coach/person-tool.ts). Plain Aimee only: a
          // Coach conversation stays on its one subject.
          makePersonRecordTool({ companyId: convo.company_id }),
        ]
      : []),
    ...(await buildCoachTools({
      subjectProfileId:
        convo.mode === "about" ? convo.subject_profile_id ?? null : null,
      companyId: convo.company_id,
    })),
    // PRACTICE TOOLS, registered for the practice running and
    // nowhere else. A tool the model can always see is a tool it
    // will sometimes reach for: the Functional Chart is the Role
    // Description Builder's working material and nobody else's, and
    // a coach that can list every function is a coach that will.
    //
    // Deduped by name against what buildCoachTools already returned,
    // so a practice declaring a tool the coach also has cannot send
    // Anthropic two definitions with one name — which is an API
    // error, not a precedence question.
    //
    // FROM THE PINNED CONFIG, not the code registry. The conversation
    // runs the agent version it was pinned to (resolveRuntimeConfig):
    // its prompt, model and token ceiling already came from there, and
    // its tools have to as well. Reading the registry's list meant a
    // tool change published in the Agent Hub never reached a
    // conversation, and an agent that exists only in the Hub got no
    // tools at all (investigation, 2026-09-28).
    ...resolvePracticeTools(
      agentConfig?.tools,
      convo.company_id,
      convo.revising_role_id ?? null,
      convo.debriefing_meeting_id ?? null
    ),
  ].filter(
    (t, i, all) => all.findIndex((o) => o.definition.name === t.definition.name) === i
  );
  const toolDefs = tools.map((t) => t.definition);

  // ---- TURNS HELD BACK AND CHECKED ------------------------------
  //
  // Two kinds of turn are buffered rather than streamed, checked,
  // sent back once with what was wrong, and only then shown: a
  // generated opener (nobody typed it; Aimee reached out first), and
  // every reply in a meeting debrief, which on dev broke a countable
  // rule every time, invented quotes included. The
  // cost is the typing effect: the reader sees "Thinking…" until the
  // checked turn arrives whole. Everything else streams.
  //
  // And the FIRST reply of a plain Aimee conversation (2026-09-30): her
  // name, a stock "That's X, especially..." acknowledgement and two asks
  // in one question got through the instructions about half the time.
  // Later replies stream. What each is sent back for is SENT_BACK in
  // aimee/voice-check.ts.
  const isFirstPlainReply =
    convo.mode === "general" &&
    !practice &&
    !convo.debriefing_meeting_id &&
    history.every((m) => m.role !== "assistant");
  const checkedTurn: CheckedTurn | null = isGenerateOpener
    ? "opener"
    : convo.debriefing_meeting_id
      ? "debrief reply"
      : isFirstPlainReply
        ? "first reply"
        : null;

  return { model, systemPromptText, messages, tools, toolDefs, checkedTurn };
}
