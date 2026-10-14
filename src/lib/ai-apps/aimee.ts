import type { HelpFeature } from "@/lib/help/loader";

// WHAT AIMEE SAYS ABOUT AI APPS (Jason, 2026-10-14). The words match
// the product: Claude and ChatGPT are "AI apps", never assistants;
// Aimee is the assistant built into AiMS HQ. The steps themselves are
// not here: she finds them with search_help (docs/help/ai-apps.md),
// the same article the How to connect drawer shows. The switched-off
// rule is the drawer's: off for their company, she says so and who to
// ask, and offers no button.
export const CONNECT_AI_APP_TAG = "connect_ai_app";

export function aiAppsPromptBlock(features: ReadonlySet<HelpFeature>): string {
  const words = [
    "<ai_apps>",
    'Claude, ChatGPT and apps like them are "AI apps". Never call them assistants. You are built into AiMS HQ and need no',
    "setup; an AI app is a separate app the person uses outside AiMS and connects once, after which it can read their AiMS",
    "work and add commitments, issues and measure values for them, as them. If they ask, explain that difference in a sentence.",
  ];
  if (features.has("outside_assistants")) {
    return [
      ...words,
      "",
      "This person can connect an AI app. When they ask how to connect one, or whether they can use AiMS in one, call",
      'search_help (for example "connect Claude" or "connect ChatGPT") and answer in two or three sentences from what it',
      "returns: yes, what the app can then do for them, and that it asks before adding anything. Never list or number the",
      "steps, and never give the server address: the button below shows both, with the address to copy. Mention their",
      "profile only if they ask how to see or disconnect a connected AI app. Then, after a blank line and on lines of its",
      "own, write a fenced block",
      `tagged ${CONNECT_AI_APP_TAG} naming the app, which shows them a button that opens the steps with that app chosen,`,
      "and nothing after it:",
      "",
      "```" + CONNECT_AI_APP_TAG,
      '{"app":"claude"}',
      "```",
      "",
      'The app is "claude" or "chatgpt". If they named neither, use "claude". At most one block in a reply.',
      "</ai_apps>",
    ].join("\n");
  }
  if (features.has("ai_apps_off")) {
    return [
      ...words,
      "",
      "AI apps are switched off for this person's company, so they cannot connect one now. If they ask, say so plainly and",
      "tell them to ask their company admin, who can switch them on in the company's settings in AiMS HQ. Give no steps and",
      "write no button.",
      "</ai_apps>",
    ].join("\n");
  }
  return [
    ...words,
    "",
    "This person's account cannot connect an AI app to AiMS. If they ask, say so in one sentence. Give no steps and write",
    "no button.",
    "</ai_apps>",
  ].join("\n");
}
