// The pure parts of the worker's browser (0303), kept apart from
// Playwright so they can be tested without a browser: which addresses
// it may open, and how Claude's key names become Playwright's.

// ---- Addresses ------------------------------------------------------
//
// The browser tool's security notes (platform.claude.com, browser use
// tool): accept only http and https, parsed with a URL parser, and
// refuse loopback, link-local and private ranges. The browser runs in
// Browserbase's cloud, so those would reach Browserbase's network, never
// ours, but there is nothing there a worker has a reason to open.

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

const PRIVATE_HOST = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

export function checkUrl(raw: string): UrlCheck {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Error: navigate needs a URL." };
  // Scheme-less is https, as the tool's spec says.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: `Error: "${text}" is not a web address.` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: `Error: only http and https addresses can be opened, not ${url.protocol}` };
  }
  if (PRIVATE_HOST.some((re) => re.test(url.hostname))) {
    return { ok: false, error: `Error: ${url.hostname} is a private address and cannot be opened.` };
  }
  return { ok: true, url: url.toString() };
}

// ---- Keys -----------------------------------------------------------
//
// Claude names keys the way people write them ("ctrl+a", "Enter",
// "cmd+shift+t", "Backspace Backspace"); Playwright wants its own names
// joined by "+" ("Control+a").

const KEY_NAMES: Record<string, string> = {
  ctrl: "Control",
  control: "Control",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  opt: "Alt",
  cmd: "Meta",
  command: "Meta",
  meta: "Meta",
  super: "Meta",
  win: "Meta",
  enter: "Enter",
  return: "Enter",
  esc: "Escape",
  escape: "Escape",
  tab: "Tab",
  space: " ",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  page_up: "PageUp",
  pagedown: "PageDown",
  page_down: "PageDown",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
};

function keyName(part: string): string {
  const known = KEY_NAMES[part.toLowerCase()];
  if (known) return known;
  if (/^f([1-9]|1[0-2])$/i.test(part)) return part.toUpperCase();
  // A single character stays exactly as written ("a", "A", "/").
  return part;
}

// One chord: "ctrl+shift+t" -> "Control+Shift+t". A lone "+" is the
// plus key.
export function toPlaywrightChord(chord: string): string {
  if (chord === "+") return "+";
  return chord
    .split("+")
    .filter((p) => p.length > 0)
    .map(keyName)
    .join("+");
}

// The key member's text: one chord, or several separated by spaces.
export function keySequence(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(toPlaywrightChord);
}

// The click members' modifiers ("shift", "ctrl+shift") as Playwright's.
export type Modifier = "Alt" | "Control" | "Meta" | "Shift";

export function toModifiers(chord: string | undefined): Modifier[] {
  if (!chord) return [];
  const out: Modifier[] = [];
  for (const part of chord.split("+")) {
    const name = keyName(part.trim());
    if (name === "Alt" || name === "Control" || name === "Meta" || name === "Shift") out.push(name);
  }
  return out;
}

// ---- Finding elements by words --------------------------------------
//
// The find member is a plain-words search ("search field"). The page
// listing already names every element with its role, so find scores
// each line by the query's words and returns the best 20.

export function rankLines(lines: readonly string[], query: string, limit = 20): string[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const scored = lines
    .map((line, i) => {
      const lower = line.toLowerCase();
      const score = words.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
      return { line, i, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.line.trim());
}
