// The models an agent version may name.
//
// ---- WHY THIS IS A CLOSED LIST -------------------------------
//
// `agent_versions.model` is a text column, and the obvious
// implementation was a text box. A typo in a text box is a broken
// agent: the Anthropic API rejects an unknown id, the turn fails,
// and the person who finds out is a client mid-conversation rather
// than the admin who made the change. The publish note would say
// something reasonable and the version would look fine in history.
//
// So free text never reaches the column. The Config tab offers a
// dropdown built from this list, the server action validates against
// it again (a dropdown is a suggestion, not a guarantee — the action
// is the boundary), and the runtime drops an unrecognised value
// rather than passing it to the API.
//
// ---- WHY IT IS NOT DERIVED FROM THE CODE'S OWN CONSTANTS -----
//
// Every module here carries its own `DEFAULT_MODEL = "claude-sonnet-5"`
// and the crons carry `"claude-haiku-4-5"`. Those are decisions about
// what a particular surface runs, and reading them as "the set of
// models an agent may use" would conflate two different questions
// and change this list every time somebody retunes a cron.

export type AgentModelOption = {
  value: string;
  label: string;
  hint: string;
};

export const AGENT_MODEL_OPTIONS: ReadonlyArray<AgentModelOption> = [
  {
    value: "claude-sonnet-5",
    label: "Sonnet 5",
    hint: "The platform default. What every surface runs today.",
  },
  {
    value: "claude-opus-5",
    label: "Opus 5",
    hint: "Slower and dearer. For an agent doing genuinely hard reasoning.",
  },
  {
    value: "claude-haiku-4-5",
    label: "Haiku 4.5",
    hint: "Fast and cheap. Suits a narrow, well-scripted flow.",
  },
];

export const VALID_AGENT_MODELS = new Set<string>(
  AGENT_MODEL_OPTIONS.map((m) => m.value)
);

// Blank means "use the platform default", which is the env override
// if one is set and otherwise the product default. That is a real
// choice rather than an absent one, and it is what every version
// starts as.
export const AGENT_MODEL_DEFAULT_LABEL = "Platform default";

export function isValidAgentModel(value: string | null | undefined): boolean {
  if (!value) return true; // blank is the default, and is valid
  return VALID_AGENT_MODELS.has(value);
}
