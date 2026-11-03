// Fenced tag -> card, for the whole product.
//
// ---- WHY THIS IS ITS OWN MODULE --------------------------------
//
// ChatView is a client component and this map has to reach it. The
// registry cannot: it carries `import "server-only"` and reads prompt
// files off disk, so importing it from the client fails the build
// with "You're importing a component that needs server-only".
//
// The registry's own comment already said the VALUES were safe to
// serialize to a client component; what it could not say is that the
// MODULE is not. Hence a file with no imports at all.
//
// ---- WHY IT IS NOT PER-AGENT -----------------------------------
//
// It used to be: a field on each Practice, a column on
// agent_versions, and a control in the Hub. Every mapping was
// identical — all four agents paired the same three tags with the
// same three cards, and none ever paired a tag differently. The
// configuration carried no information, and three screens asked an
// admin to think about it.
//
// As a constant it also does something the per-agent version could
// not. There was no way to ADD a mapping from the Hub, so an agent
// built there could never have a card at all; now it gets one simply
// by telling the model to emit one of these tags, which its prompt
// has to say anyway.

export type OutputCardName =
  | "ScriptCard"
  | "ChartProposalCard"
  | "RoleDescriptionCard"
  | "CommitmentDraftCard"
  | "SessionOfferCard"
  | "ConnectAiAppCard"
  | "VividVisionCard";

export const OUTPUT_CARD_BY_TAG: Readonly<Record<string, OutputCardName>> = {
  script: "ScriptCard",
  chart_proposal: "ChartProposalCard",
  role_description: "RoleDescriptionCard",
  // Aimee's draft of the leader's next step (coach/commitment-draft.ts),
  // in every conversation: the principles end every coaching loop with
  // the offer.
  commitment: "CommitmentDraftCard",
  // Aimee's offer of a guided session (aimee/session-offer-block.ts),
  // in open conversations only: the route tells no one else how to
  // write it, and the start action refuses an offer anywhere else.
  session_offer: "SessionOfferCard",
  // Aimee's button to the How to connect drawer, an AI app chosen
  // (lib/ai-apps/aimee.ts); only where the person can connect one.
  connect_ai_app: "ConnectAiAppCard",
  // The Vivid Vision agent's finished document, saved by the leader to
  // the One-Page Plan's Vision card (lib/foundation/vivid-vision.ts).
  vivid_vision: "VividVisionCard",
};

// A card's fence only opens a code block at the start of a line, and
// the model sometimes writes it straight after its last sentence
// ("...in that session?```session_offer"). Rendered as it came, the
// card showed as raw JSON in the reply (seen on dev, 2026-10-05). For
// the tags above only, a fence that does not start a line is moved
// onto one, after a blank line. Anything else is left as written.
const CARD_FENCE_MID_LINE = new RegExp(
  "([^\\n])[ \\t]*(```(?:" + Object.keys(OUTPUT_CARD_BY_TAG).join("|") + ")\\b)",
  "g"
);

export function cardFencesOnOwnLine(text: string): string {
  return rejoinVividVisionFence(text.replace(CARD_FENCE_MID_LINE, "$1\n\n$2"));
}

// A Vivid Vision block closed too early (seen on dev, 2026-11-03): the
// model ended the fence after the story and wrote Proof Points, What
// We Protect, the themes and the summary below it as plain text, so
// the card, the PDF and Save all had the story alone. When a closing
// fence inside a vivid_vision block is followed by one of the block's
// own section headings, the fence was premature and is dropped, so the
// block runs on to the real closing fence (or the end). Used by the
// chat's display and by the server's reading of a message
// (vividVisionInMessage), so every consumer sees the same block.
const VIVID_SECTION_AFTER = /^## (Proof Points|What We Protect|Strategic Focus Themes|Closing|One-Page Plan Summary)\b/m;

export function rejoinVividVisionFence(text: string): string {
  const open = text.search(/^```vivid_vision\b.*$/m);
  if (open === -1) return text;
  let out = text;
  let from = out.indexOf("\n", open) + 1;
  for (let guard = 0; guard < 6; guard++) {
    const close = out.slice(from).search(/^```[ \t]*$/m);
    if (close === -1) return out;
    const at = from + close;
    const lineEnd = out.indexOf("\n", at);
    const after = lineEnd === -1 ? "" : out.slice(lineEnd + 1);
    const nextFence = after.search(/^```/m);
    const between = nextFence === -1 ? after : after.slice(0, nextFence);
    if (!VIVID_SECTION_AFTER.test(between)) return out;
    out = out.slice(0, at) + (lineEnd === -1 ? "" : out.slice(lineEnd + 1));
    from = at;
  }
  return out;
}
