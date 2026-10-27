// WHEN A WORKER ASKS FIRST (0303, step 2). Before a click or an Enter,
// the browser reads the element it would press; this decides whether
// that press changes something on the website, and whether it is one of
// the kinds that always asks.
//
// Reading a page, searching, opening links and signing in never ask.
// Saving, sending or submitting asks unless the owner switched on "Edit
// records in websites" or chose Allow always for that site. Paying,
// buying, deleting, posting in public, changing who has access and
// accepting terms ask every time, whatever was chosen.

export type PressTarget = {
  tag: string; // lower case
  type: string; // the input or button type, lower case
  role: string;
  text: string; // its name: label, text, value
  href: string | null;
  inForm: boolean;
  searchForm: boolean; // a search box or a form that is one
};

export type PressCheck = { action: string; alwaysAsks: boolean } | null;

const ALWAYS = /\b(pay|payment|buy|purchase|place (your )?order|check ?out|delete|remove|erase|cancel (my |your )?(account|subscription|order)|publish|post|tweet|share|invite|grant|permission|access|transfer|send money|accept|agree|terms|subscribe|donate|unsubscribe)\b/i;
const CHANGES = /\b(submit|send|save|confirm|apply|update|create|add|book|reserve|register|sign up|enrol|enroll|finish|complete|approve|reject|upload|request|schedule|change|edit|archive|close|mark)\b/i;
const SAFE = /\b(search|find|go|filter|sort|sign in|log ?in|next|previous|back|more|show|view|open|close menu|menu|expand|collapse|details|accept cookies|ok)\b/i;

export function checkPress(t: PressTarget): PressCheck {
  const text = t.text.replace(/\s+/g, " ").trim().slice(0, 120);
  const label = text || (t.type === "submit" ? "Submit" : "the button");
  if (t.searchForm) return null;

  const isLink = t.tag === "a" && Boolean(t.href) && t.role !== "button";
  const isSubmit =
    (t.tag === "button" && (t.type === "submit" || t.type === "") && t.inForm) ||
    (t.tag === "input" && (t.type === "submit" || t.type === "image"));
  const isButton = t.tag === "button" || t.role === "button" || isSubmit || (t.tag === "input" && t.type === "button");

  // The kinds that always ask, on any button or link that names them,
  // except a cookie banner's Accept.
  if ((isButton || isLink) && ALWAYS.test(text) && !/cookie/i.test(text)) {
    return { action: `Press "${label}"`, alwaysAsks: true };
  }
  if (isLink) return null;
  if (!isButton) return null;
  if (SAFE.test(text) && !CHANGES.test(text)) return null;
  if (isSubmit || CHANGES.test(text)) return { action: `Press "${label}"`, alwaysAsks: false };
  return null;
}

// Enter in a field submits its form: the same check, made on the form's
// own submit button, or as a plain "Submit the form" when it has none.
export function checkEnter(field: PressTarget & { submitText: string | null }): PressCheck {
  if (!field.inForm || field.searchForm) return null;
  if (field.tag === "textarea") return null;
  return checkPress({ ...field, tag: "button", type: "submit", role: "", text: field.submitText ?? "Submit the form", href: null });
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

// A rule for example.com covers shop.example.com too.
export function ruleCovers(ruleDomain: string, domain: string): boolean {
  const r = ruleDomain.replace(/^www\./, "").toLowerCase();
  return domain === r || domain.endsWith(`.${r}`);
}
