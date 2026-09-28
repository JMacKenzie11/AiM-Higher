import "server-only";

import type { Role } from "@/lib/types";
import type { ModuleFeature } from "@/lib/subscriptions/service";
import type { CoachTool } from "@/lib/coach/tools";
import { searchHelp } from "./search";

// Aimee's help search. The role and the company's features are closed
// over from the SESSION when the route builds the tool list: the model
// supplies a query and nothing else, so it cannot ask for another
// role's help, and a result's link is only ever a page this person can
// open (search.ts).
export function makeSearchHelpTool(args: { role: Role; features: readonly ModuleFeature[] }): CoachTool {
  return {
    definition: {
      name: "search_help",
      description:
        "Search the AiMS app's own help pages, the ones this person is allowed to read, for how a feature works or how to do something in the app. " +
        "Returns up to three matching sections with the page they belong to and, when the person can open it, the page's path to link to. " +
        "Use it for questions about using the app, not for coaching. If nothing comes back, say you could not find it in the help rather than guessing how the app works.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What the person wants to do or understand, in a few words (e.g. 'add a quarterly priority', 'what does follow-through rate mean').",
          },
        },
        required: ["query"],
      },
    },
    handler: async (input) => {
      const query =
        typeof (input as { query?: unknown })?.query === "string"
          ? (input as { query: string }).query.trim().slice(0, 200)
          : "";
      if (!query) return { status: "empty" as const, results: [] };
      const results = await searchHelp(query, args.role, args.features);
      return results.length > 0
        ? { status: "found" as const, results }
        : { status: "none" as const, results: [], note: "Nothing in the help matched. Say so; do not guess." };
    },
  };
}
