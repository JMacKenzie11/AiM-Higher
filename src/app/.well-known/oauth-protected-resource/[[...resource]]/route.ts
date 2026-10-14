import { generateProtectedResourceMetadata } from "mcp-handler";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { currentRequestOrigin } from "@/lib/instances/origin";
import { mcpEnabled } from "@/lib/mcp/switch";

// OAuth Protected Resource Metadata (RFC 9728) for the MCP server.
//
// How an outside assistant finds out where to sign a person in: the
// MCP route's 401 points here, and this names this instance's Supabase
// Auth as the authorization server. Served at both
// /.well-known/oauth-protected-resource and
// /.well-known/oauth-protected-resource/api/mcp, the two forms clients
// ask for. Per instance by construction: the origin and the Supabase
// project both come from the host the request arrived on.
export async function GET(): Promise<Response> {
  if (!mcpEnabled()) return new Response("Not found", { status: 404 });
  const origin = await currentRequestOrigin();
  const instance = await getCurrentInstanceConfig();
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [`${instance.supabaseUrl}/auth/v1`],
    resourceUrl: `${origin}/api/mcp`,
    additionalMetadata: {
      resource_name: "AiMS HQ",
      bearer_methods_supported: ["header"],
    },
  });
  return Response.json(metadata, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
