import type { MetricValueType } from "@/lib/types";

// How a measure's number is written down, and how it is read back.
//
// ---- ONE RULE, STATED ONCE -------------------------------------
//
// STORAGE IS ALWAYS THE TRUE NUMBER. 18000000, never 18. Scale
// applies at the EDGES — the entry box, the target box, the rendered
// cell — and nowhere in between.
//
// That direction is chosen, not incidental. A value reaches a
// measure two ways:
//
//   a person types it into a 72px cell, and will not type 18000000
//   an external pull takes it from a spreadsheet, where it IS
//   18000000 (parseSheetNumber does a plain Number, and pulls are
//   live)
//
// Scaling on the way IN from the sheet would put 18 and 18000000 in
// one column and leave every later read guessing which it had.
// Scaling on the way OUT means the pull needs no translation at all,
// because what it writes is already canonical.
//
// Everything below is pure, so both edges can use the same functions
// and cannot drift apart.

export type MeasureScale = "plain" | "thousands" | "millions";

export const MEASURE_SCALES: ReadonlyArray<{
  value: MeasureScale;
  label: string;
  // What the entry box says under it, so the unit is visible at the
  // moment somebody types rather than only when they read it back.
  hint: string;
}> = [
  { value: "plain", label: "As entered", hint: "" },
  { value: "thousands", label: "Thousands (k)", hint: "in thousands" },
  { value: "millions", label: "Millions (M)", hint: "in millions" },
];

const FACTOR: Record<MeasureScale, number> = {
  plain: 1,
  thousands: 1_000,
  millions: 1_000_000,
};

const SUFFIX: Record<MeasureScale, string> = {
  plain: "",
  thousands: "k",
  millions: "M",
};

export function parseScale(raw: unknown): MeasureScale {
  return raw === "thousands" || raw === "millions" || raw === "plain"
    ? raw
    : "plain";
}

// Scale only means anything for a number. A percent in millions is
// not a thing, and text has no magnitude at all.
export function scaleApplies(valueType: MetricValueType): boolean {
  return valueType === "number" || valueType === "currency";
}

function factorFor(valueType: MetricValueType, scale: MeasureScale): number {
  return scaleApplies(valueType) ? FACTOR[scale] : 1;
}

// Stored → the figure a person sees in an input box.
export function toEntryNumber(
  stored: number,
  valueType: MetricValueType,
  scale: MeasureScale
): number {
  return stored / factorFor(valueType, scale);
}

// What a person typed → what is stored.
export function toStoredNumber(
  typed: number,
  valueType: MetricValueType,
  scale: MeasureScale
): number {
  return typed * factorFor(valueType, scale);
}

// WHOLE DOLLARS, BUT NOT WHOLE ANYTHING-ELSE.
//
// "$1,234 with no decimals" was asked for and applies to plain
// money: cents are noise on a weekly scorecard. It does NOT apply to
// a plain number — "Days Sales Outstanding" records 38.6, and
// rounding that to 39 would quietly destroy the precision somebody
// entered. Nor to a scaled figure: production's backlog runs 13.2 to
// 21.67 in millions, which rounded to whole millions is the only
// variation there is, gone.
//
// So exactly one case rounds, and it is the one that was asked for.
function formatScaled(
  n: number,
  scale: MeasureScale,
  valueType: MetricValueType
): string {
  const decimals = valueType === "currency" && scale === "plain" ? 0 : 2;
  const fixed = n.toFixed(decimals);
  // Trailing zeros carry no information: 18.00M is 18M.
  const trimmed = decimals > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
  const [whole, fraction] = trimmed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

// Stored → what appears on the page.
export function formatMeasureValue(
  valueType: MetricValueType,
  scale: MeasureScale,
  value: { number: number | null; text: string | null } | null,
  blank = ""
): string {
  if (!value) return blank;
  if (valueType === "text") return value.text ?? blank;
  if (value.number == null || !Number.isFinite(value.number)) return blank;

  const shown = toEntryNumber(value.number, valueType, scale);
  if (valueType === "percent") return `${value.number}%`;
  if (valueType === "currency") {
    // The minus goes outside the symbol: -$400, not $-400.
    const sign = shown < 0 ? "-" : "";
    return `${sign}$${formatScaled(Math.abs(shown), scale, valueType)}${SUFFIX[scale]}`;
  }
  return `${formatScaled(shown, scale, valueType)}${SUFFIX[scale]}`;
}

// A target is free text, and for a numeric measure it is typed in
// the same unit as a value: "18" under millions means eighteen
// million, and is stored as 18000000 so that a target and a value
// are comparable without either side knowing about scale.
//
// This is the parse for that box. It tolerates what people type —
// "$18", "18M", "1,234" — because a box that rejects a dollar sign
// on a currency measure is a box arguing with its own label.
export function parseTypedNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// A target as typed → the target as stored.
//
// The box takes the measure's own unit ("18" on a millions measure
// means eighteen million) and storage holds the true number, so the
// same conversion a value gets is applied here. Without it a target
// of 18 would be compared against a stored 18000000 and every week
// on that measure would read as wildly off target.
//
// Text targets ("Yes", "Green") pass through untouched: there is no
// magnitude to scale, and rewriting them would destroy them.
export function storedTargetText(
  typed: string | null,
  valueType: MetricValueType,
  scale: MeasureScale
): string | null {
  if (typed === null) return null;
  if (!scaleApplies(valueType) || scale === "plain") return typed;
  const n = parseTypedNumber(typed);
  if (n === null) return typed;
  return String(toStoredNumber(n, valueType, scale));
}
