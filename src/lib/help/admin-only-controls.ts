// THE CONTROLS ONLY ADMINS HAVE, on pages every role can open
// (2026-09-29).
//
// A team member asked Aimee's panel how to add a function and got the
// admins' steps, plus a description of the admin-only Functional Chart
// Builder. The pages hid the controls; the help did not. This list is
// the one both halves are checked against:
//
//   help-for-team-members.test.ts  the help a team member reads (and
//                                  Aimee searches for them) names none
//   e2e/team-member-view.spec.ts   a team member sees none on the page,
//                                  and a company admin sees them, which
//                                  proves the names are the real ones
//
// Only controls hidden from a PLAIN team member (no function led, no
// seat, no reports). Controls an owner, a function lead, a manager or
// the champion can use are left out on purpose.

export type AdminOnlyControls = {
  path: string;
  // Visible labels, exactly as the page renders them. Matched with
  // their case in the help, and on the page in the browser test.
  controls: readonly string[];
  // How the help words those same actions, matched without case (the
  // help test). The admin's help must use at least one, so a phrase
  // list that drifted from the help's wording fails rather than passing
  // on words the help never uses.
  helpPhrases: readonly string[];
};

export const ADMIN_ONLY_CONTROLS: readonly AdminOnlyControls[] = [
  { path: "/chart", controls: ["Add function"], helpPhrases: ["add function", "add a function"] },
  {
    path: "/plan",
    controls: ["Add focus area", "Add goal", "Add quarterly priority"],
    helpPhrases: ["add focus area", "add goal", "add quarterly priority"],
  },
  {
    path: "/foundation",
    controls: ["+ Add core value", "+ Add differentiator"],
    helpPhrases: ["add core value", "add differentiator", "edit purpose"],
  },
  {
    path: "/quarters",
    // "Close" on the open quarter's row. "Open quarter" only appears
    // when no quarter is open, which the fixture never is.
    controls: ["Close"],
    // Not "open quarter": the help calls the current quarter "the open
    // quarter", a noun every role may read.
    helpPhrases: ["open the next quarter", "open next quarter", "close the open quarter"],
  },
  { path: "/people", controls: ["Add user"], helpPhrases: ["add user", "add a person", "deactivate"] },
];

// Names a team member's help never mentions on ANY page: admin-only
// tools, not controls on one page.
export const ADMIN_ONLY_TOOLS: readonly string[] = ["Functional Chart Builder", "Apply to Chart"];
