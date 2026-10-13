import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { currentRequestOrigin } from "@/lib/instances/origin";
import { mcpEnabled, mcpOpenTo } from "@/lib/mcp/switch";
import { assistantClient, verifyAssistantToken } from "@/lib/mcp/auth";

// THE AiMS MCP SERVER (Phase 1: the sign-in trial).
//
// An outside assistant (Claude, ChatGPT and similar) connects here after
// the person signs in through Supabase's OAuth server and approves it on
// /oauth/consent. One tool for now, who_am_i, to prove the whole path:
// discovery, sign-in, consent, a token that acts as the person and
// nothing more. The menu's tools arrive in Phase 2.
//
// Every request carries the assistant's token, which is checked by
// verifyAssistantToken (this instance's signature and issuer, and a
// client_id: an ordinary app sign-in is refused) and then used as-is on
// a client that acts as the person. Never the service role. The
// database's allow list (0270) refuses that token everything off the
// menu, whatever this code does.
//
// Switched off unless MCP_ENABLED is "true", and open only to system
// admins unless MCP_FOR_EVERYONE is (lib/mcp/switch.ts).

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "who_am_i",
      {
        title: "Who am I in AiMS",
        description:
          "The AiMS HQ person this assistant is signed in as: their name, role and company. Read only.",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (ctx) => {
        const token = ctx.http?.authInfo?.token;
        const userId = ctx.http?.authInfo?.extra?.userId;
        if (!token || typeof userId !== "string") {
          return { isError: true, content: [{ type: "text", text: "Not signed in." }] };
        }
        const db = await assistantClient(token);
        const { data: profile } = await db
          .from("profiles")
          .select("full_name, role, company_id")
          .eq("id", userId)
          .maybeSingle<{ full_name: string | null; role: string; company_id: string | null }>();
        if (!profile) {
          return { isError: true, content: [{ type: "text", text: "No AiMS profile for this sign-in." }] };
        }
        if (!mcpOpenTo(profile.role)) {
          return {
            isError: true,
            content: [{ type: "text", text: "Outside assistants aren't open to your AiMS account yet." }],
          };
        }
        let company: string | null = null;
        if (profile.company_id) {
          const { data } = await db
            .from("companies")
            .select("name")
            .eq("id", profile.company_id)
            .maybeSingle<{ name: string }>();
          company = data?.name ?? null;
        }
        const who = { name: profile.full_name, role: profile.role, company };
        return {
          content: [{ type: "text", text: JSON.stringify(who) }],
          structuredContent: who,
        };
      }
    );
  },
  { serverInfo: { name: "AiMS HQ", version: "0.1.0" } }
);

async function route(request: Request): Promise<Response> {
  if (!mcpEnabled()) return new Response("Not found", { status: 404 });
  const origin = await currentRequestOrigin();
  const authed = withMcpAuth(
    handler,
    async (_req, bearer) => {
      const caller = await verifyAssistantToken(bearer);
      if (!caller) return undefined;
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
