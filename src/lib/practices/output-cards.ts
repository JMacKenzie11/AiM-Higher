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
  | "RoleDescriptionCard";

export const OUTPUT_CARD_BY_TAG: Readonly<Record<string, OutputCardName>> = {
  script: "ScriptCard",
  chart_proposal: "ChartProposalCard",
  role_description: "RoleDescriptionCard",
};
