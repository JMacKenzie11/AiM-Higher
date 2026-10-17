import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { currentRequestOrigin } from "@/lib/instances/origin";
import { mcpOpenTo } from "@/lib/mcp/switch";
import { mcpEnabledHere } from "@/lib/mcp/switch-here";
import { isClientApproved } from "@/lib/mcp/client-approval";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assistantClient, verifyAssistantToken } from "@/lib/mcp/auth";
import { AddRefused, addCommitment, addIssue, addMeasureValue } from "@/lib/mcp/adds";
import { workWithAimee } from "@/lib/mcp/handoff";
import { chooseCompany, type VisibleCompany } from "@/lib/mcp/company";
import { limitBroken, limitMessage } from "@/lib/mcp/limits";
import { recentCounts, recordAction } from "@/lib/mcp/log";
import {
  ReadFailed,
  annualGoals,
  companyPlan,
  functionalChart,
  measures,
  meetingSummaries,
  myCommitments,
  openIssues,
  quarterlyPriorities,
  teamCommitments,
  visibleCompanies,
} from "@/lib/mcp/reads";

// THE AiMS MCP SERVER (Phase 2: the read menu).
//
// An outside assistant (Claude, ChatGPT and similar) connects here after
// the person signs in through Supabase's OAuth server and approves it on
// /oauth/consent. Phase 2 serves the reads (lib/mcp/reads.ts): who am I,
// my companies, my and my team's commitments, measures with recent
// values, open issues, meeting summaries and the functional chart. Each
// request names a company, filled in for a person who sees one. Every
// call is logged and rate limited (lib/mcp/log.ts, limits.ts). No adds
// until Phase 3.
//
// Every request carries the assistant's token, which is checked by
// verifyAssistantToken (this instance's signature and issuer, and a
// client_id: an ordinary app sign-in is refused) and then used as-is on
// a client that acts as the person. Never the service role. The
// database's allow list (0270) refuses that token everything off the
// menu, whatever this code does.
//
// Switched off unless MCP_ENABLED is "true", and open to every role but
// portfolio admins (lib/mcp/switch.ts; the database gate agrees, 0284).

type Caller = { token: string; userId: string; clientId: string };

function callerOf(ctx: unknown): Caller | null {
  const info = (ctx as { http?: { authInfo?: { token?: string; clientId?: string; extra?: { userId?: unknown } } } })
    .http?.authInfo;
  const userId = info?.extra?.userId;
  if (!info?.token || !info.clientId || typeof userId !== "string") return null;
  return { token: info.token, userId, clientId: info.clientId };
}

const say = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });

// How many rows an answer carries, for the log: the length of every
// list at its top level.
function rowsIn(data: Record<string, unknown>): number {
  return Object.values(data).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
}

// EVERY TOOL RUNS THROUGH THIS. In order: the person is signed in and
// active, and outside assistants are open to their role (the switch);
// they are under their own limit; the company the request names is one
// they can see, filled in when they see only one; the company is under
// its limit; then the read, on the assistant's token. Every outcome,
// refusals included, is one row in assistant_actions.
async function runTool<A>(
  tool: string,
  needsCompany: boolean,
  ctx: unknown,
  args: A & { company?: string },
  read: (c: { db: SupabaseClient; userId: string; company: VisibleCompany | null }, args: A) => Promise<Record<string, unknown>>
) {
  const caller = callerOf(ctx);
  if (!caller) return say("Not signed in.");
  const started = Date.now();
  let companyId: string | null = null;
  const log = (outcome: "ok" | "refused" | "error" | "rate_limited", reason: string | null, rowCount?: number) =>
    recordAction({
      profileId: caller.userId,
      companyId,
      clientId: caller.clientId,
      tool,
      outcome,
      reason,
      rowCount: rowCount ?? null,
      durationMs: Date.now() - started,
    });

  try {
    const personLoad = await recentCounts("profile_id", caller.userId);
    const personBroken = limitBroken(personLoad, null);
    if (personBroken) {
      await log("rate_limited", personBroken);
      return say(limitMessage(personBroken));
    }

    const db = await assistantClient(caller.token);
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role, status")
      .eq("id", caller.userId)
      .maybeSingle<{ role: string; status: string }>();
    // A failed read (a revoked token's PT401 among them) is an error,
    // not a missing profile.
    if (profileError) throw new ReadFailed(profileError.code ?? "unknown");
    if (!profile || profile.status !== "active") {
      await log("refused", "no_active_profile");
      return say("No active AiMS profile for this sign-in.");
    }
    if (!mcpOpenTo(profile.role)) {
      await log("refused", "not_open");
      return say("AI apps aren't open to your AiMS account yet.");
    }

    let company: VisibleCompany | null = null;
    if (needsCompany) {
      const choice = chooseCompany(await visibleCompanies(db), args.company);
      if (!choice.ok) {
        await log("refused", choice.reason);
        return say(choice.message);
      }
      company = choice.company;
      companyId = company.id;
      // THE COMPANY'S OWN SWITCH (0279), for everyone, system admins
      // included: no company's data reaches an outside assistant until
      // that company has switched it on.
      if (!company.assistantsOn) {
        await log("refused", "company_off");
        return say(
          `AI apps are switched off for ${company.name}. Ask your company admin; they can switch them on in the company's settings in AiMS HQ.`
        );
      }
      const companyBroken = limitBroken({ lastMinute: 0, lastHour: 0 }, await recentCounts("company_id", company.id));
      if (companyBroken) {
        await log("rate_limited", companyBroken);
        return say(limitMessage(companyBroken));
      }
    }

    const data = await read({ db, userId: caller.userId, company }, args);
    await log("ok", null, rowsIn(data));
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
  } catch (e) {
    if (e instanceof AddRefused) {
      await log("refused", e.reason);
      return say(e.message);
    }
    const code = e instanceof ReadFailed ? e.code : "";
    const refused = code === "42501" || code === "PT401";
    await log("error", refused ? "db_refused" : "db_error");
    return say(
      code === "PT401"
        ? "This AI app's access to AiMS has ended. Connect it again."
        : "AiMS couldn't answer that just now."
    );
  }
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
// Every add (Phase 3). readOnlyHint false is what tells an assistant
// this changes something, so it asks the person before calling it by
// default (Jason, 2026-10-14). Never destructive: nothing is replaced or
// removed. Not idempotent: calling twice adds twice, which the
// commitment duplicate guard and the empty-week rule refuse.
const ADDS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
// work_with_aimee (0281). It writes one short-lived record and changes
// nothing in the company's data, but it is not read-only, so it is not
// labelled as such: an assistant asks before calling it unless the
// person has allowed it. Not destructive, not idempotent (each call is
// a new link).
const HANDOFF = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const company = z
  .string()
  .max(200)
  .optional()
  .describe("The company, by name or id. Leave it out if you're in only one; list_my_companies shows the choices.");

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "who_am_i",
      {
        title: "Who am I in AiMS",
        description: "The AiMS HQ person this assistant is signed in as: their name, role and home company. Read only.",
        annotations: READ_ONLY,
      },
      async (ctx) =>
        runTool("who_am_i", false, ctx, {}, async ({ db, userId }) => {
          const { data: p, error } = await db
            .from("profiles")
            .select("full_name, role, company_id")
            .eq("id", userId)
            .maybeSingle<{ full_name: string | null; role: string; company_id: string | null }>();
          if (error) throw new ReadFailed(error.code ?? "unknown");
          let home: string | null = null;
          if (p?.company_id) {
            const { data } = await db.from("companies").select("name").eq("id", p.company_id).maybeSingle<{ name: string }>();
            home = data?.name ?? null;
          }
          return { name: p?.full_name ?? null, role: p?.role ?? null, company: home };
        })
    );

    server.registerTool(
      "list_my_companies",
      {
        title: "List my companies",
        description:
          "The AiMS companies you can see, by name and id, and whether each has outside assistants switched on. Every other tool takes one of these as its company, and works only where they are on.",
        annotations: READ_ONLY,
      },
      async (ctx) =>
        runTool("list_my_companies", false, ctx, {}, async ({ db }) => ({
          companies: (await visibleCompanies(db)).map((c) => ({
            id: c.id,
            name: c.name,
            outside_assistants: c.assistantsOn ? "on" : "off: a company admin can switch them on",
          })),
        }))
    );

    server.registerTool(
      "my_commitments",
      {
        title: "My commitments",
        description:
          "Your own commitments in a company: everything open (parked ones marked), and what you resolved in the last four weeks, with any notes. A weekly repeating commitment shows its recent weeks. Read only.",
        inputSchema: z.object({ company }),
        annotations: READ_ONLY,
      },
      async (args, ctx) => runTool("my_commitments", true, ctx, args, (c) => myCommitments({ ...c, company: c.company! }))
    );

    server.registerTool(
      "team_commitments",
      {
        title: "My team's commitments",
        description:
          "Everyone else's open commitments in a company, and unassigned ones, with owner, due date and any notes. Parked ones are left out. Read only.",
        inputSchema: z.object({ company }),
        annotations: READ_ONLY,
      },
      async (args, ctx) => runTool("team_commitments", true, ctx, args, (c) => teamCommitments({ ...c, company: c.company! }))
    );

    server.registerTool(
      "measures",
      {
        title: "Measures and recent values",
        description:
          "A company's critical success factors, grouped by function, with each one's target and its values for recent weeks. Weeks are named by the Monday they begin. Read only.",
        inputSchema: z.object({
          company,
          weeks: z.number().int().min(1).max(13).optional().describe("How many recent weeks of values, 1 to 13. Default 6."),
        }),
        annotations: READ_ONLY,
      },
      async (args, ctx) =>
        runTool("measures", true, ctx, args, (c, a) => measures({ ...c, company: c.company! }, a.weeks ?? 6))
    );

    server.registerTool(
      "open_issues",
      {
        title: "Open issues",
        description: "A company's open issues in rank order, with the outcome wanted, any notes, and who raised each. Read only.",
        inputSchema: z.object({ company }),
        annotations: READ_ONLY,
      },
      async (args, ctx) => runTool("open_issues", true, ctx, args, (c) => openIssues({ ...c, company: c.company! }))
    );

    server.registerTool(
      "meeting_summaries",
      {
        title: "Meeting summaries",
        description:
          "Summaries of a company's recent analysed meetings, newest first, with the commitments each one found. Summaries only: never transcripts. Read only.",
        inputSchema: z.object({
          company,
          limit: z.number().int().min(1).max(8).optional().describe("How many meetings, 1 to 8. Default 5."),
        }),
        annotations: READ_ONLY,
      },
      async (args, ctx) =>
        runTool("meeting_summaries", true, ctx, args, (c, a) => meetingSummaries({ ...c, company: c.company! }, a.limit ?? 5))
    );

    server.registerTool(
      "functional_chart",
      {
        title: "The functional chart",
        description:
          "A company's functions in chart order: who each reports to, its Lead, its purpose, roles, decision rights and competencies. Read only.",
        inputSchema: z.object({ company }),
        annotations: READ_ONLY,
      },
      async (args, ctx) => runTool("functional_chart", true, ctx, args, (c) => functionalChart({ ...c, company: c.company! }))
    );

    server.registerTool(
      "quarterly_priorities",
      {
        title: "Quarterly priorities",
        description:
          "A company's priorities for one quarter, with owner, due date, status, and the annual goal and focus area each serves. Defaults to the open quarter. Read only.",
        inputSchema: z.object({
          company,
          quarter: z.string().max(40).optional().describe('A quarter label as AiMS shows it, such as "Q3 2026". Default: the open quarter.'),
        }),
        annotations: READ_ONLY,
      },
      async (args, ctx) =>
        runTool("quarterly_priorities", true, ctx, args, (c, a) => quarterlyPriorities({ ...c, company: c.company! }, a.quarter))
    );

    server.registerTool(
      "annual_goals",
      {
        title: "Annual goals",
        description: "A company's annual goals, with owner, target date, status and the focus area each serves. Read only.",
        inputSchema: z.object({ company }),
        annotations: READ_ONLY,
      },
      async (args, ctx) => runTool("annual_goals", true, ctx, args, (c) => annualGoals({ ...c, company: c.company! }))
    );

    server.registerTool(
      "company_plan",
      {
        title: "Core values and plan",
        description:
          "A company's purpose, vision, core values and strategic focus areas (with sponsor and status). Read only.",
        inputSchema: z.object({ company }),
        annotations: READ_ONLY,
      },
      async (args, ctx) => runTool("company_plan", true, ctx, args, (c) => companyPlan({ ...c, company: c.company! }))
    );

    server.registerTool(
      "add_commitment",
      {
        title: "Add a commitment",
        description:
          "Adds a commitment for the signed-in person (never anyone else) in a company. It counts at once, with no draft step. A due date is required. AiMS checks its clarity the same way as in the app, and refuses the same wording twice on the same day. Ask the person before calling this.",
        inputSchema: z.object({
          company,
          description: z.string().min(1).max(500).describe("What the person commits to, in their words."),
          due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("When it is due, YYYY-MM-DD. Required."),
        }),
        annotations: ADDS,
      },
      async (args, ctx) =>
        runTool("add_commitment", true, ctx, args, (c, a) =>
          addCommitment({ ...c, company: c.company! }, { description: a.description, due_date: a.due_date }))
    );

    server.registerTool(
      "add_issue",
      {
        title: "Add an issue",
        description:
          "Adds an open issue to a company's list, raised by the signed-in person. Ask the person before calling this.",
        inputSchema: z.object({
          company,
          title: z.string().min(1).max(200).describe("The issue, in a line."),
          desired_outcome: z.string().max(1000).optional().describe("What a good outcome looks like, if the person said."),
        }),
        annotations: ADDS,
      },
      async (args, ctx) =>
        runTool("add_issue", true, ctx, args, (c, a) =>
          addIssue({ ...c, company: c.company! }, { title: a.title, desired_outcome: a.desired_outcome }))
    );

    server.registerTool(
      "add_measure_value",
      {
        title: "Add a measure value",
        description:
          "Enters a value for one week of a measure, only if that week has none. Only an admin or the measure's function Lead may. Never changes an existing value. The measures tool gives the measure ids. Ask the person before calling this.",
        inputSchema: z.object({
          company,
          measure_id: z.string().uuid().describe("The measure's id, from the measures tool."),
          value: z.string().min(1).max(200).describe('The value as the person said it, such as "12,500" or "95%".'),
          week_beginning: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe("The Monday the week begins, YYYY-MM-DD. Default: this week."),
        }),
        annotations: ADDS,
      },
      async (args, ctx) =>
        runTool("add_measure_value", true, ctx, args, (c, a) =>
          addMeasureValue({ ...c, company: c.company! }, { measure_id: a.measure_id, value: a.value, week_beginning: a.week_beginning }))
    );

    server.registerTool(
      "work_with_aimee",
      {
        title: "Work with Aimee in AiMS",
        description:
          "Use this when the person wants help that Aimee, AiMS's coach, handles better inside AiMS: coaching on a person or on their own leadership, preparing or handling a hard conversation, designing or changing the functional chart, writing a role description, or debriefing a meeting. Do not coach on these yourself at length; offer this instead. Write a short, neutral summary of what they want help with as the topic (one or two sentences, no names of anyone's health, family or private life). Only that topic is sent to AiMS, never this conversation. Returns a link that opens Aimee in AiMS with the right guide loaded and the topic filled in; show the person the returned message with the link. It does not coach and returns nothing from Aimee. The link works once, for this person only, for 24 hours.",
        inputSchema: z.object({
          company,
          topic: z.string().min(1).max(500).describe("A short summary of what the person wants help with, in one or two sentences."),
        }),
        annotations: HANDOFF,
      },
      async (args, ctx) =>
        runTool("work_with_aimee", true, ctx, args, (c, a) => workWithAimee({ ...c, company: c.company! }, { topic: a.topic }))
    );
  },
  { serverInfo: { name: "AiMS HQ", version: "0.5.0" } }
);

async function route(request: Request): Promise<Response> {
  if (!(await mcpEnabledHere())) return new Response("Not found", { status: 404 });
  const origin = await currentRequestOrigin();
  const authed = withMcpAuth(
    handler,
    async (_req, bearer) => {
      const caller = await verifyAssistantToken(bearer);
      if (!caller) return undefined;
      // Approved assistants only (0280): a token for any other client
      // is refused here as well as by the token hook and the database.
      if (!(await isClientApproved(caller.clientId))) return undefined;
      return {
        token: bearer as string,
        clientId: caller.clientId,
        scopes: [],
        expiresAt: caller.expiresAt,
        extra: { userId: caller.userId },
      };
    },
    {
      required: true,
      resourceMetadataPath: "/.well-known/oauth-protected-resource/api/mcp",
      resourceUrl: origin,
    }
  );
  return authed(request);
}

export { route as GET, route as POST, route as DELETE };
