import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadFunctionContext } from "./context";
import type { getChartFunctionDetail } from "@/lib/chart/service";

// Full-document Role Description generation. One Sonnet call, one
// JSON response covering every section that isn't a direct render
// of chart data: Position Summary, per-outcome enrichments,
// per-responsibility strategic context, Strengths & Expertise,
// Qualifications, and Why This Role Matters.
//
// Everything else on the RD page renders straight from the chart
// entities. This service only produces the generated prose that
// wraps around them.
//
// Best-effort: if the API key is missing or the model returns bad
// JSON, returns null and the view page falls back to a bare
// rendering (data-only, no prose). No exception ever leaves.

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 3000;

export type RdDocument = {
  positionSummary: string;
  outcomeEnrichments: Array<{
    matchTitle: string;
    whyItMatters: string;
    valuesConnection: string;
  }>;
  responsibilityEnrichments: Array<{
    matchTitle: string;
    strategicContext: string;
  }>;
  strengthsAndExpertise: {
    technical: string[];
    strategic: string[];
    interpersonal: string[];
    accountability: string;
  };
  qualifications: {
    experience: string;
    education: string;
    certifications: string;
  };
  whyThisRoleMatters: string;
};

// Partial RdDocument shape for user-edited overrides. Stored as a
// jsonb column on role_description_documents; merged over the
// generated `document` at render time.
//
//   - positionSummary / whyThisRoleMatters — free-form prose that
//     wins as-is when non-empty.
//   - outcomeEnrichments / responsibilityEnrichments — arrays keyed
//     by matchTitle. Merged per key: if an override for a given
//     matchTitle exists, its non-empty fields replace the generated
//     ones; missing/empty fields fall back to the model output.
//   - strengthsAndExpertise / qualifications — sub-object where any
//     present field replaces the generated one. Arrays inside
//     strengths (technical/strategic/interpersonal) replace the
//     whole list when provided.
export type RdUserOverrides = {
  positionSummary?: string;
  whyThisRoleMatters?: string;
  outcomeEnrichments?: Array<{
    matchTitle: string;
    whyItMatters?: string;
    valuesConnection?: string;
  }>;
  responsibilityEnrichments?: Array<{
    matchTitle: string;
    strategicContext?: string;
  }>;
  strengthsAndExpertise?: {
    technical?: string[];
    strategic?: string[];
    interpersonal?: string[];
    accountability?: string;
  };
  qualifications?: {
    experience?: string;
    education?: string;
    certifications?: string;
  };
};

function pickString(
  override: string | undefined,
  fallback: string
): string {
  if (typeof override !== "string") return fallback;
  const t = override.trim();
  return t.length > 0 ? override : fallback;
}

function pickStringArray(
  override: string[] | undefined,
  fallback: string[]
): string[] {
  if (!Array.isArray(override)) return fallback;
  const cleaned = override
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : fallback;
}

// Layer user overrides over the generated document. Non-empty
// override values win; empty strings and missing fields fall back
// to the model output.
export function mergeRoleDescription(
  doc: RdDocument | null,
  overrides: RdUserOverrides | null
): RdDocument | null {
  if (!doc) return null;
  if (!overrides) return doc;

  const outcomeOverrideByTitle = new Map<
    string,
    { whyItMatters?: string; valuesConnection?: string }
  >();
  for (const o of overrides.outcomeEnrichments ?? []) {
    if (o.matchTitle) {
      outcomeOverrideByTitle.set(o.matchTitle, {
        whyItMatters: o.whyItMatters,
        valuesConnection: o.valuesConnection,
      });
    }
  }
  const respOverrideByTitle = new Map<string, { strategicContext?: string }>();
  for (const r of overrides.responsibilityEnrichments ?? []) {
    if (r.matchTitle) {
      respOverrideByTitle.set(r.matchTitle, {
        strategicContext: r.strategicContext,
      });
    }
  }

  return {
    ...doc,
    positionSummary: pickString(overrides.positionSummary, doc.positionSummary),
    whyThisRoleMatters: pickString(
      overrides.whyThisRoleMatters,
      doc.whyThisRoleMatters
    ),
    outcomeEnrichments: doc.outcomeEnrichments.map((e) => {
      const ov = outcomeOverrideByTitle.get(e.matchTitle);
      if (!ov) return e;
      return {
        matchTitle: e.matchTitle,
        whyItMatters: pickString(ov.whyItMatters, e.whyItMatters),
        valuesConnection: pickString(ov.valuesConnection, e.valuesConnection),
      };
    }),
    responsibilityEnrichments: doc.responsibilityEnrichments.map((e) => {
      const ov = respOverrideByTitle.get(e.matchTitle);
      if (!ov) return e;
      return {
        matchTitle: e.matchTitle,
        strategicContext: pickString(
          ov.strategicContext,
          e.strategicContext
        ),
      };
    }),
    strengthsAndExpertise: {
      technical: pickStringArray(
        overrides.strengthsAndExpertise?.technical,
        doc.strengthsAndExpertise.technical
      ),
      strategic: pickStringArray(
        overrides.strengthsAndExpertise?.strategic,
        doc.strengthsAndExpertise.strategic
      ),
      interpersonal: pickStringArray(
        overrides.strengthsAndExpertise?.interpersonal,
        doc.strengthsAndExpertise.interpersonal
      ),
      accountability: pickString(
        overrides.strengthsAndExpertise?.accountability,
        doc.strengthsAndExpertise.accountability
      ),
    },
    qualifications: {
      experience: pickString(
        overrides.qualifications?.experience,
        doc.qualifications.experience
      ),
      education: pickString(
        overrides.qualifications?.education,
        doc.qualifications.education
      ),
      certifications: pickString(
        overrides.qualifications?.certifications,
        doc.qualifications.certifications
      ),
    },
  };
}

// Helpers used by the UI to know which sections have been overridden
// (drives the "Edited — Restore generated" affordance).
export function isOutcomeOverridden(
  overrides: RdUserOverrides | null,
  matchTitle: string,
  field: "whyItMatters" | "valuesConnection"
): boolean {
  if (!overrides?.outcomeEnrichments) return false;
  const entry = overrides.outcomeEnrichments.find(
    (e) => e.matchTitle === matchTitle
  );
  if (!entry) return false;
  const v = entry[field];
  return typeof v === "string" && v.trim().length > 0;
}

export function isResponsibilityOverridden(
  overrides: RdUserOverrides | null,
  matchTitle: string
): boolean {
  if (!overrides?.responsibilityEnrichments) return false;
  const entry = overrides.responsibilityEnrichments.find(
    (e) => e.matchTitle === matchTitle
  );
  if (!entry) return false;
  const v = entry.strategicContext;
  return typeof v === "string" && v.trim().length > 0;
}

export function isStrengthOverridden(
  overrides: RdUserOverrides | null,
  field: "technical" | "strategic" | "interpersonal" | "accountability"
): boolean {
  const s = overrides?.strengthsAndExpertise;
  if (!s) return false;
  const v = s[field];
  if (Array.isArray(v)) {
    return v.some((x) => typeof x === "string" && x.trim().length > 0);
  }
  return typeof v === "string" && v.trim().length > 0;
}

export function isQualificationOverridden(
  overrides: RdUserOverrides | null,
  field: "experience" | "education" | "certifications"
): boolean {
  const q = overrides?.qualifications;
  if (!q) return false;
  const v = q[field];
  return typeof v === "string" && v.trim().length > 0;
}

type Detail = NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>;

let cachedSystemPrompt: string | null = null;
async function loadSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const file = path.join(process.cwd(), "prompts", "rd-document.md");
  cachedSystemPrompt = await fs.readFile(file, "utf8");
  return cachedSystemPrompt;
}

export async function generateRoleDescription(
  detail: Detail
): Promise<RdDocument | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const ctx = await loadFunctionContext(detail.fn.id);
  if (!ctx) return null;

  const systemPrompt = await loadSystemPrompt();
  const userMessage = buildUserMessage(detail, ctx);

  const model = process.env.ANTHROPIC_RD_DOC_MODEL || DEFAULT_MODEL;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: systemPrompt }],
      messages: [{ role: "user", content: userMessage }],
    });
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseDocument(raw);
  } catch (err) {
    console.warn("generateRoleDescription failed:", err);
    return null;
  }
}

function buildUserMessage(
  detail: Detail,
  ctx: Awaited<ReturnType<typeof loadFunctionContext>>
): string {
  if (!ctx) return "";
  const lines: string[] = [];

  lines.push("<company>");
  lines.push(`Name: ${ctx.company.companyName}`);
  if (ctx.company.purposeStatement) {
    lines.push(`Purpose: ${ctx.company.purposeStatement}`);
  }
  if (ctx.company.vision) {
    lines.push(`Vision: ${ctx.company.vision}`);
  }
  if (ctx.company.coreValues.length > 0) {
    lines.push("Core values:");
    for (const cv of ctx.company.coreValues) {
      lines.push(
        `- ${cv.title}${cv.body ? ` — ${cv.body}` : ""}`
      );
    }
  }
  if (ctx.company.differentiators.length > 0) {
    lines.push("Differentiators:");
    for (const d of ctx.company.differentiators) {
      lines.push(`- ${d.title}${d.body ? ` — ${d.body}` : ""}`);
    }
  }
  lines.push("</company>");

  lines.push("");
  lines.push("<function>");
  lines.push(`Title: ${detail.fn.title}`);
  if (detail.parent) {
    lines.push(`Sits under: ${detail.parent.title}`);
  }
  if (detail.fn.description) {
    lines.push(`Description: ${detail.fn.description}`);
  }
  // Seat holder deliberately omitted — the RD describes the SEAT,
  // not the current person. Mentioning a name in the Position
  // Summary ties the doc to the incumbent and makes it awkward at
  // turnover time. The prompt also prohibits naming people.
  lines.push("</function>");

  const userRoles = detail.roles.filter((r) => !r.is_default);
  if (userRoles.length > 0) {
    lines.push("");
    lines.push("<responsibilities>");
    for (const r of userRoles) {
      lines.push(`- ${r.title}${r.body ? ` (${r.body})` : ""}`);
    }
    lines.push("</responsibilities>");
  }

  if (detail.outcomes.length > 0) {
    lines.push("");
    lines.push("<outcomes>");
    for (const o of detail.outcomes) {
      lines.push(`- ${o.title}${o.description ? ` — ${o.description}` : ""}`);
      if (o.measures.length > 0) {
        for (const m of o.measures) {
          lines.push(
            `  · ${m.description}${m.target ? ` (target ${m.target})` : ""}`
          );
        }
      }
    }
    lines.push("</outcomes>");
  }

  if (detail.decisionRights.length > 0) {
    lines.push("");
    lines.push("<decision_rights>");
    for (const d of detail.decisionRights) {
      lines.push(`- ${d.title}${d.body ? ` — ${d.body}` : ""}`);
    }
    lines.push("</decision_rights>");
  }

  if (detail.competencies.length > 0) {
    lines.push("");
    lines.push("<competencies>");
    for (const c of detail.competencies) {
      lines.push(`- ${c.title}${c.body ? ` — ${c.body}` : ""}`);
    }
    lines.push("</competencies>");
  }

  lines.push("");
  lines.push(
    "Draft the full role description for this seat as JSON. Follow the schema exactly."
  );

  return lines.join("\n");
}

function parseDocument(raw: string): RdDocument | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const str = (v: unknown): string =>
    typeof v === "string" ? v.trim() : "";
  const strArr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
      : [];

  const outcomeEnrichments = Array.isArray(obj.outcomeEnrichments)
    ? obj.outcomeEnrichments
        .filter(
          (x): x is Record<string, unknown> =>
            !!x && typeof x === "object"
        )
        .map((x) => ({
          matchTitle: str(x.matchTitle),
          whyItMatters: str(x.whyItMatters),
          valuesConnection: str(x.valuesConnection),
        }))
        .filter((x) => x.matchTitle)
    : [];

  const responsibilityEnrichments = Array.isArray(obj.responsibilityEnrichments)
    ? obj.responsibilityEnrichments
        .filter(
          (x): x is Record<string, unknown> =>
            !!x && typeof x === "object"
        )
        .map((x) => ({
          matchTitle: str(x.matchTitle),
          strategicContext: str(x.strategicContext),
        }))
        .filter((x) => x.matchTitle)
    : [];

  const strengths = (obj.strengthsAndExpertise ?? {}) as Record<string, unknown>;
  const quals = (obj.qualifications ?? {}) as Record<string, unknown>;

  return {
    positionSummary: str(obj.positionSummary),
    outcomeEnrichments,
    responsibilityEnrichments,
    strengthsAndExpertise: {
      technical: strArr(strengths.technical),
      strategic: strArr(strengths.strategic),
      interpersonal: strArr(strengths.interpersonal),
      accountability: str(strengths.accountability),
    },
    qualifications: {
      experience: str(quals.experience),
      education: str(quals.education),
      certifications: str(quals.certifications),
    },
    whyThisRoleMatters: str(obj.whyThisRoleMatters),
  };
}
