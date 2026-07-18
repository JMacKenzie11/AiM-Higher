import Anthropic from "@anthropic-ai/sdk";

// Mirrors Strengths Map's original singleton so its API endpoints
// (and any code that used SM's `anthropic()` / `ANTHROPIC_MODEL`)
// keep compiling after the port. Reads the shared coach-model env
// var so both modules pin the same model when it's set.

export const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_COACH_MODEL || "claude-sonnet-4-6";

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}
