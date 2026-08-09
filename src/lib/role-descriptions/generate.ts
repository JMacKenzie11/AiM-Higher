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
// generated `document` at render time. v1 only accepts the two
// prose-heavy sections — expanding to structured fields later
// doesn't need a schema change.
export type RdUserOverrides = {
  positionSummary?: string;
  whyThisRoleMatters?: string;
};

// Layer user overrides over the generated document. Non-empty
// override values win; empty strings and missing fields fall back
// to the model output.
export function mergeRoleDescription(
  doc: RdDocument | null,
  overrides: RdUserOverrides | null
): RdDocument | null {
  if (!doc) return null;
  if (!overrides) return doc;
  return {
    ...doc,
    positionSummary:
      overrides.positionSummary && overrides.positionSummary.trim().length > 0
        ? overrides.positionSummary
        : doc.positionSummary,
    whyThisRoleMatters:
      overrides.whyThisRoleMatters &&
      overrides.whyThisRoleMatters.trim().length > 0
        ? overrides.whyThisRoleMatters
        : doc.whyThisRoleMatters,
  };
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
  if (detail.seatHolder) {
    lines.push(`Currently in the seat: ${detail.seatHolder.full_name}`);
  }
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
