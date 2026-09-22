// The role description document, as the agent emits it and as the
// card, the Save action, the .docx export and the saved-document
// page all read it.
//
// One definition of "valid", for the same reason parse-chart-
// proposal.ts is one: the card renders it, the action writes it and
// the page renders it back, and three opinions about what counts as
// a document is how a leader saves something that will not open.
//
// ---- WHAT IS AND IS NOT REJECTED -------------------------------
//
// Structure is enforced: a section that should be a list of objects
// with two string fields is rejected when it is anything else, and
// the card falls back to its "Fix the proposal" nudge.
//
// CONTENT IS NOT. A critical success factor with no target is a
// documented, allowed state and must survive as null rather than be
// refused or coerced to "". An empty capabilities list is a real
// answer. The parser's job is "can this be rendered and stored",
// not "is this a good role description".
//
// ---- ALIASES, AND WHY THERE ARE ANY ----------------------------
//
// The first real conversation emitted `title` for `category`,
// `behavior` for `behaviour`, and `decides_alone` for `decides`.
// Every one of those is a reasonable guess at an English field
// name, and the prompt at the time did not carry the schema, so the
// model had nothing to guess against. The prompt carries it now.
//
// The aliases stay anyway, because two of those three would have
// failed SILENTLY. A missing `behaviour` becomes "" and a missing
// `decides` becomes [], so the document would have saved with every
// excellence line blank and the decision rights empty, and nobody
// would have been told. A loud rejection is recoverable; a saved
// document with holes in it is discovered by whoever reads it next.
//
// Aliases are only ever accepted where the meaning is unambiguous
// and the shape is identical. There is no alias for `function` as a
// bare string: see parseFunctionRef.
//
// ---- ON-CHART AND OFF-CHART ------------------------------------
//
// `function` is null for a role that is not a seat on the chart,
// and `supports_functions` then carries the titles of whatever it
// supports, which may legitimately be an empty array: the prompt
// asks the question and "none" is an acceptable answer. Both cases
// round-trip through here unchanged, which is what the test at the
// bottom of parse-document.test.ts exists to hold.

export type RdValueType = "number" | "currency" | "percent" | "text";
export type RdTargetDirection = "higher_is_better" | "lower_is_better";
export type RdUpdateFrequency = "weekly" | "biweekly" | "monthly";

export type RdFunctionRef = { id: string; title: string };

export type RdResponsibility = { category: string; description: string };

export type RdCriticalSuccessFactor = {
  description: string;
  target: string | null;
  value_type: RdValueType;
  target_direction: RdTargetDirection;
  update_frequency: RdUpdateFrequency;
  why_it_matters: string;
};

export type RdDecisionRights = {
  decides: string[];
  decides_with: string[];
  recommends: string[];
};

export type RdExcellence = { value: string; behaviour: string };

export type RoleDescriptionDoc = {
  version: number;
  title: string;
  function: RdFunctionRef | null;
  supports_functions: string[];
  reports_to: string;
  why_this_role_exists: string;
  responsibilities: RdResponsibility[];
  critical_success_factors: RdCriticalSuccessFactor[];
  decision_rights: RdDecisionRights;
  what_excellence_looks_like: RdExcellence[];
  capabilities: string[];
  qualifications: string[];
  why_this_role_matters: string;
};

const VALUE_TYPES: readonly RdValueType[] = [
  "number",
  "currency",
  "percent",
  "text",
];
const DIRECTIONS: readonly RdTargetDirection[] = [
  "higher_is_better",
  "lower_is_better",
];
const FREQUENCIES: readonly RdUpdateFrequency[] = [
  "weekly",
  "biweekly",
  "monthly",
];

export function parseRoleDescription(raw: string): RoleDescriptionDoc | null {
  if (!raw || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const o = parsed as Record<string, unknown>;

  const title = str(o.title);
  if (title === null || title.trim() === "") return null;

  const fn = parseFunctionRef(o.function);
  if (fn === undefined) return null;

  const supports = strList(o.supports_functions);
  if (supports === null) return null;

  const responsibilities = parseResponsibilities(o.responsibilities);
  if (responsibilities === null) return null;

  const csfs = parseCsfs(o.critical_success_factors);
  if (csfs === null) return null;

  const rights = parseDecisionRights(o.decision_rights);
  if (rights === null) return null;

  const excellence = parseExcellence(o.what_excellence_looks_like);
  if (excellence === null) return null;

  const capabilities = strList(o.capabilities);
  if (capabilities === null) return null;

  const qualifications = strList(o.qualifications);
  if (qualifications === null) return null;

  return {
    // Defaulted rather than required. A document that is otherwise
    // complete and forgot to stamp itself is a document, and
    // refusing it would cost the leader the whole interview.
    version: typeof o.version === "number" ? o.version : 1,
    title,
    function: fn,
    supports_functions: supports,
    reports_to: str(o.reports_to) ?? "",
    why_this_role_exists: str(o.why_this_role_exists) ?? "",
    responsibilities,
    critical_success_factors: csfs,
    decision_rights: rights,
    what_excellence_looks_like: excellence,
    capabilities,
    qualifications,
    why_this_role_matters: str(o.why_this_role_matters) ?? "",
  };
}

// `undefined` means invalid, `null` means "legitimately off the
// chart". Collapsing those two into null would make a malformed
// function object silently become an off-chart role, which is a
// document that quietly says something untrue about the company.
//
// A BARE STRING IS NOT ACCEPTED, though the model has emitted one.
// `"function": "Field Operations"` carries no id, and the id is
// what links the saved document to the seat on the chart: accepting
// the string would produce a role description that looks on-chart
// in its prose and is off-chart in the database, listed on /roles
// with no way back to the function it describes. Rejecting is loud
// and the nudge names the fix.
function parseFunctionRef(raw: unknown): RdFunctionRef | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (!isObject(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  const title = str(o.title);
  if (id === null || title === null) return undefined;
  return { id, title };
}

function parseResponsibilities(raw: unknown): RdResponsibility[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RdResponsibility[] = [];
  for (const item of raw) {
    if (!isObject(item)) return null;
    const o = item as Record<string, unknown>;
    // `title` is the model's recurring guess and means the same
    // thing in the same shape.
    const category = str(o.category) ?? str(o.title);
    if (category === null || category.trim() === "") return null;
    out.push({ category, description: str(o.description) ?? "" });
  }
  return out;
}

function parseCsfs(raw: unknown): RdCriticalSuccessFactor[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RdCriticalSuccessFactor[] = [];
  for (const item of raw) {
    if (!isObject(item)) return null;
    const o = item as Record<string, unknown>;
    const description = str(o.description);
    if (description === null || description.trim() === "") return null;

    // NO TARGET IS A REAL ANSWER. It renders as "no target set" and
    // never as off target; coercing it to "" here would lose the
    // difference between "we have not set one" and "we set it to
    // nothing".
    const rawTarget = o.target;
    const target =
      rawTarget === null || rawTarget === undefined
        ? null
        : typeof rawTarget === "string"
          ? rawTarget
          : typeof rawTarget === "number"
            ? String(rawTarget)
            : undefined;
    if (target === undefined) return null;

    // An unrecognised enum is a bug upstream, not a reason to lose
    // the factor. Fall back to the same defaults the add form uses,
    // which is what the leader would have got by not choosing.
    out.push({
      description,
      target,
      value_type: oneOf(o.value_type, VALUE_TYPES, "number"),
      target_direction: oneOf(o.target_direction, DIRECTIONS, "higher_is_better"),
      update_frequency: oneOf(o.update_frequency, FREQUENCIES, "weekly"),
      why_it_matters: str(o.why_it_matters) ?? "",
    });
  }
  return out;
}

function parseDecisionRights(raw: unknown): RdDecisionRights | null {
  // Absent is an empty set of rights, not a malformed document: the
  // interview can reach the end with a leader who said "nothing yet".
  if (raw === null || raw === undefined) {
    return { decides: [], decides_with: [], recommends: [] };
  }
  if (!isObject(raw)) return null;
  const o = raw as Record<string, unknown>;
  // decides_alone / decides_with_others are the model's phrasing of
  // the same three buckets. Without these the rights vanish without
  // a word, which is the failure this parser exists to avoid.
  const decides = strList(o.decides ?? o.decides_alone);
  const decidesWith = strList(o.decides_with ?? o.decides_with_others);
  const recommends = strList(o.recommends);
  if (decides === null || decidesWith === null || recommends === null) {
    return null;
  }
  return { decides, decides_with: decidesWith, recommends };
}

function parseExcellence(raw: unknown): RdExcellence[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RdExcellence[] = [];
  for (const item of raw) {
    if (!isObject(item)) return null;
    const o = item as Record<string, unknown>;
    const value = str(o.value);
    if (value === null || value.trim() === "") return null;
    // American spelling, which a model will reach for regardless of
    // what the prompt says. Blank behaviour on every line is a
    // document that renders as a list of value names.
    out.push({ value, behaviour: str(o.behaviour) ?? str(o.behavior) ?? "" });
  }
  return out;
}

// ---- primitives -------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// Missing is an empty list. Present-but-not-a-list is malformed:
// "capabilities": "communication" is a document somebody will read
// as a one-item list and we would render as nothing.
function strList(v: unknown): string[] | null {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

function oneOf<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

// Plain text, for Copy. Mirrors chartProposalToPlainText: the text
// somebody pastes into an email must say what the card says, so
// both are generated from the parsed document rather than one from
// the document and one from the raw JSON.
export function roleDescriptionToPlainText(doc: RoleDescriptionDoc): string {
  const lines: string[] = [];
  lines.push(doc.title);
  if (doc.function) lines.push(`Function: ${doc.function.title}`);
  else if (doc.supports_functions.length > 0) {
    lines.push(`Not on the chart. Supports: ${doc.supports_functions.join(", ")}`);
  } else {
    lines.push("Not on the chart.");
  }
  if (doc.reports_to) lines.push(`Reports to: ${doc.reports_to}`);

  const section = (heading: string, body: string[]) => {
    if (body.length === 0) return;
    lines.push("", heading.toUpperCase(), ...body);
  };

  section("Why this role exists", doc.why_this_role_exists ? [doc.why_this_role_exists] : []);
  section(
    "Responsibilities",
    doc.responsibilities.map((r) =>
      r.description ? `- ${r.category}: ${r.description}` : `- ${r.category}`
    )
  );
  section(
    "Critical success factors",
    doc.critical_success_factors.flatMap((c) => {
      const target = c.target === null ? "no target set" : c.target;
      const head = `- ${c.description} (${target}, ${c.update_frequency})`;
      return c.why_it_matters ? [head, `  ${c.why_it_matters}`] : [head];
    })
  );
  section("Decides", doc.decision_rights.decides.map((d) => `- ${d}`));
  section("Decides with others", doc.decision_rights.decides_with.map((d) => `- ${d}`));
  section("Recommends", doc.decision_rights.recommends.map((d) => `- ${d}`));
  section(
    "What excellence looks like",
    doc.what_excellence_looks_like.map((e) => `- ${e.value}: ${e.behaviour}`)
  );
  section("Capabilities", doc.capabilities.map((c) => `- ${c}`));
  section("Qualifications", doc.qualifications.map((q) => `- ${q}`));
  section("Why this role matters", doc.why_this_role_matters ? [doc.why_this_role_matters] : []);

  return lines.join("\n");
}
