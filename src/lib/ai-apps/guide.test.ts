import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHelpForRoute } from "@/lib/help/loader";
import { splitAiAppsGuide } from "./guide";
import { aiAppsPromptBlock, CONNECT_AI_APP_TAG } from "./aimee";
import { OUTPUT_CARD_BY_TAG } from "@/lib/practices/output-cards";
import { parseConnectAiApp } from "@/components/ai-apps/ConnectAiAppCard";

afterEach(() => vi.unstubAllEnvs());

const ADDRESS = "https://www.aims-hq.com/api/mcp";
const on = { subdomain: "@", companyAssistantsOn: true, mcpAddress: ADDRESS };
const off = { ...on, companyAssistantsOn: false };

describe("the How to connect article, the one source", () => {
  it("gives the drawer all three approved apps, each with the instance's address", async () => {
    vi.stubEnv("MCP_ENABLED", "true");
    const doc = await loadHelpForRoute("/ai-apps", "team_member", on);
    const { apps, off: offText } = splitAiAppsGuide(doc!.markdown);
    expect(apps.map((a) => a.id)).toEqual(["claude", "chatgpt", "grok"]);
    expect(offText).toBeNull();
    for (const a of apps) {
      expect(a.markdown).toContain(ADDRESS);
      expect(a.markdown).not.toContain("{{mcp_address}}");
      for (const part of [`### Connect`, `### Try this first`, `### Disconnect`, `### If`]) {
        expect(a.markdown).toContain(part);
      }
      // Claude and ChatGPT ask before adding; Grok Bot's help says to check instead.
      if (a.id !== "grok") expect(a.markdown).toContain("### Keep");
    }
  });

  it("says switched off, and who to ask, where the company has them off", async () => {
    vi.stubEnv("MCP_ENABLED", "true");
    const doc = await loadHelpForRoute("/ai-apps", "company_admin", off);
    const { apps, off: offText } = splitAiAppsGuide(doc!.markdown);
    expect(apps).toEqual([]);
    expect(offText).toMatch(/Ask your company admin/);
  });

  it("is not there for a portfolio admin", async () => {
    vi.stubEnv("MCP_ENABLED", "true");
    expect(await loadHelpForRoute("/ai-apps", "portfolio_admin", on)).toBeNull();
  });
});

describe("Aimee on AI apps", () => {
  it("offers the button only where the person can connect one", () => {
    const yes = aiAppsPromptBlock(new Set(["outside_assistants"]));
    expect(yes).toContain("```" + CONNECT_AI_APP_TAG);
    expect(yes).toMatch(/Never call them assistants/);
    const offBlock = aiAppsPromptBlock(new Set(["ai_apps_off"]));
    expect(offBlock).toMatch(/company admin/);
    expect(offBlock).not.toContain("```");
    expect(aiAppsPromptBlock(new Set())).not.toContain("```");
  });

  it("has a card for the tag, and the card reads only an approved app", () => {
    expect(OUTPUT_CARD_BY_TAG[CONNECT_AI_APP_TAG]).toBe("ConnectAiAppCard");
    expect(parseConnectAiApp('{"app":"chatgpt"}')).toBe("chatgpt");
    expect(parseConnectAiApp('{"app":"grok"}')).toBe("grok");
    expect(parseConnectAiApp('{"app":"cursor"}')).toBeNull();
    expect(parseConnectAiApp("{")).toBeNull();
  });
});
