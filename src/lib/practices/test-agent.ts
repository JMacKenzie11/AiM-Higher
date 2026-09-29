// THE TEST-ONLY AGENT (2026-09-29).
//
// The agent-version browser tests publish versions, pin conversations
// to them, and revert to the code default. They used to do that to a
// real agent ("Ask great questions"), which briefly changed it for
// every company on the dev clone, and a run stopped halfway left it on
// a test version. Tests never change a real agent (docs/e2e.md), so
// they use this one.
//
// Defined in code, because the revert test needs a code default to
// revert to. Gated on the e2e_testing feature, which only the E2E
// fixture companies have and no screen can switch on, so it appears in
// no one's agent list anywhere else. The Agent Hub shows it only while
// you are inside a fixture company. seed:e2e resets it to its code
// default before every run.

export const TEST_AGENT_ID = "e2e-version-test";
export const TEST_ONLY_FEATURE = "e2e_testing";
export const TEST_AGENT_CODE_CHIP = "Code default opening";
