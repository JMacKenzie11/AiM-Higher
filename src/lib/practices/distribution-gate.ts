// The gate on every distribution WRITE.
//
// ---- why a flag and not a branch ------------------------------
//
// The apply path ships unexercised: the fleet is the main instance
// plus one client, so the first real push cannot happen until a
// third instance exists. Leaving the code on a branch until then
// means an apply path rotting against six months of changes to the
// things it calls. Merging it behind a gate keeps it compiling,
// linted, typechecked and reviewed alongside everything else.
//
// ---- why the check is server-side -----------------------------
//
// A disabled button is a hint, not a control. The server action
// checks this before it does anything, so the gate holds against
// somebody calling the action directly — which is the only version
// of the check that means anything.
//
// ---- when it flips --------------------------------------------
//
// After the acceptance walk passes in the window between
// provisioning the next instance and onboarding its client. Not
// before: flipping it early makes the first real push its own first
// test, against a live customer. See docs/deployment.md, "The window
// after provisioning, before onboarding".

export const DISTRIBUTION_APPLY_FLAG = "AGENT_DISTRIBUTION_APPLY_ENABLED";

export function distributionApplyEnabled(): boolean {
  return process.env[DISTRIBUTION_APPLY_FLAG] === "true";
}

export const DISTRIBUTION_GATE_MESSAGE =
  "Pushing is switched off until it has been verified against a live " +
  "instance. The dry run works and is safe: it reads the target and " +
  "writes nothing.";
