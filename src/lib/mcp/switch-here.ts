import "server-only";

import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { mcpEnabled } from "./switch";

// mcpEnabled for the instance this request is on (MCP_INSTANCES).
export async function mcpEnabledHere(): Promise<boolean> {
  const instance = await getCurrentInstanceConfig();
  return mcpEnabled(instance.subdomain);
}
