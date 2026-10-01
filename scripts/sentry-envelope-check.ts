// Shows, on a running dev server, exactly what the BROWSER would send
// to Sentry, and sends none of it.
//
//   node --experimental-strip-types scripts/sentry-envelope-check.ts http://localhost:3000
//
// Not part of any suite, and not run by CI. It needs a dev server you
// started yourself, and the E2E_MEMBER_* credentials in .env.local
// (`npm run seed:e2e` creates the account).
//
// What it does:
//   1. Every request to /monitoring (the Sentry tunnel) and to any
//      *.sentry.io host is intercepted. Its body is kept, and the
//      request is ABORTED. Nothing reaches Sentry. The replay
//      recorder's own JavaScript is still fetched from
//      browser.sentry-cdn.com: that is a download, not a report.
//   2. Signs in as the e2e team member through the real form (a server
//      action POST carrying the email and password).
//   3. Waits for replay to attach, then makes a fetch with a marker in
//      its query string and a marker in its body.
//   4. Throws an uncaught error in the page.
//   5. Decodes every captured envelope (including compressed replay
//      recordings) and reports, per category, whether any of it was in
//      there: cookies, headers, IP / user, query strings, bodies, and
//      breadcrumbs carrying bodies.
//
// PASS only if an error event WAS captured and none of the categories
// appear. No envelope at all is a FAIL, not a pass: it means Sentry is
// off on this server and nothing was checked.
//
// This covers the browser only. Server and edge events leave the Node
// process directly, not through the page; the unit tests in
// src/lib/observability/scrub-event.test.ts cover those.

import { chromium, type Request } from "@playwright/test";
import { inflateSync, gunzipSync } from "node:zlib";
import { isEntryPoint } from "./lib/entry-point.ts";

export const QUERY_MARKER = "envcheckq7f3";
export const BODY_MARKER = "envcheckbody9c1d";
export const ERROR_MESSAGE = "sentry envelope check";

type Captured = { url: string; body: Buffer };

export type Secrets = {
  email: string;
  password: string;
  cookieValues: string[];
};

// ---- envelope decoding --------------------------------------------

type Item = { header: Record<string, unknown>; text: string };

function decodePayload(buf: Buffer): string {
  for (const fn of [inflateSync, gunzipSync]) {
    try {
      return fn(buf).toString("utf8");
    } catch {
      // not that encoding
    }
  }
  return buf.toString("utf8");
}

// Envelope: header line, then (item header line, payload) pairs. An
// item header may give `length` in bytes; otherwise the payload runs
// to the next newline.
export function parseEnvelope(raw: Buffer): { header: string; items: Item[] } {
  let pos = raw.indexOf(0x0a);
  const header = raw.subarray(0, pos === -1 ? raw.length : pos).toString("utf8");
  const items: Item[] = [];
  pos = pos === -1 ? raw.length : pos + 1;
  while (pos < raw.length) {
    const nl = raw.indexOf(0x0a, pos);
    const headerLine = raw.subarray(pos, nl === -1 ? raw.length : nl).toString("utf8");
    pos = nl === -1 ? raw.length : nl + 1;
    if (!headerLine.trim()) continue;
    let itemHeader: Record<string, unknown>;
    try {
      itemHeader = JSON.parse(headerLine);
    } catch {
      break;
    }
    let payload: Buffer;
    if (typeof itemHeader.length === "number") {
      payload = raw.subarray(pos, pos + itemHeader.length);
      pos += itemHeader.length + 1;
    } else {
      const end = raw.indexOf(0x0a, pos);
      payload = raw.subarray(pos, end === -1 ? raw.length : end);
      pos = end === -1 ? raw.length : end + 1;
    }
    let text: string;
    if (itemHeader.type === "replay_recording") {
      // `{"segment_id":N}\n` then the (possibly compressed) events.
      const split = payload.indexOf(0x0a);
      text =
        split === -1
          ? decodePayload(payload)
          : payload.subarray(0, split).toString("utf8") +
            "\n" +
            decodePayload(payload.subarray(split + 1));
    } else {
      text = payload.toString("utf8");
    }
    items.push({ header: itemHeader, text });
  }
  return { header, items };
}

// ---- checks --------------------------------------------------------

export type Finding = { category: string; where: string; detail: string };

function walk(
  value: unknown,
  path: string,
  visit: (path: string, key: string, v: unknown) => void
) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      visit(`${path}.${k}`, k, v);
      walk(v, `${path}.${k}`, visit);
    }
  }
}

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

export function check(
  items: { where: string; text: string }[],
  secrets: Secrets
): Finding[] {
  const findings: Finding[] = [];
  const add = (category: string, where: string, detail: string) =>
    findings.push({ category, where, detail: detail.slice(0, 160) });

  for (const { where, text } of items) {
    // Raw-text markers first: they catch a value wherever it landed.
    if (text.includes(BODY_MARKER)) add("bodies", where, `body marker "${BODY_MARKER}" present`);
    if (text.includes(QUERY_MARKER)) add("query strings", where, `query marker "${QUERY_MARKER}" present`);
    if (text.includes(secrets.password)) add("bodies", where, "the sign-in password is present");
    if (text.includes(secrets.email)) add("IP / user", where, "the signed-in email is present");
    if (/sb-[a-z0-9]+-auth-token/i.test(text)) add("cookies", where, "a Supabase auth cookie name is present");
    for (const v of secrets.cookieValues) {
      if (text.includes(v)) add("cookies", where, "a cookie value from the browser is present");
    }
    if (/"infer_ip"\s*:\s*"auto"/.test(text)) add("IP / user", where, 'infer_ip is "auto": Sentry would store the IP');
    if (text.includes("{{auto}}")) add("IP / user", where, 'an "{{auto}}" IP placeholder is present');

    // Structural checks on anything that parses as JSON (the replay
    // recording's second line is a JSON array).
    for (const line of text.split("\n")) {
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
      walk(json, where, (path, key, v) => {
        const k = key.toLowerCase();
        if (k === "cookies" || k === "cookie" || k.includes("set-cookie") || k.includes("set_cookie"))
          add("cookies", path, JSON.stringify(v));
        if (k === "headers" && v && typeof v === "object" && Object.keys(v).length > 0)
          add("headers", path, JSON.stringify(v));
        if (/^http\.(request|response)\.header\./.test(k)) add("headers", path, String(v));
        if (k === "ip_address" || k === "user.ip_address" || k === "client.address")
          add("IP / user", path, String(v));
        if (typeof v === "string" && k.includes("ip") && IPV4.test(v)) add("IP / user", path, v);
        if (k === "query_string" || k === "http.query" || k === "url.query")
          add("query strings", path, String(v));
        // Stack frames name our own script files, which in dev carry a
        // cache-busting `?v=`. That is a code URL, not a visitor's.
        const isCodeLocation =
          path.includes(".stacktrace.") || k === "filename" || k === "abs_path";
        if (
          !isCodeLocation &&
          typeof v === "string" &&
          /^(https?:\/\/|\/)[^\s"]*\?[^\s"]+=/.test(v)
        )
          add("query strings", path, v);
        if (k === "data" && path.includes(".request.") && v != null) add("bodies", path, JSON.stringify(v));
        if (/(^|\.|_)body$/.test(k) && v != null && typeof v !== "number")
          add("bodies", path, JSON.stringify(v));
      });
      // Breadcrumbs with bodies: any http breadcrumb key other than the
      // ones that are safe.
      walk(json, where, (path, key, v) => {
        if (key !== "breadcrumbs") return;
        const list = Array.isArray(v) ? v : (v as { values?: unknown[] })?.values;
        for (const bc of list ?? []) {
          const b = bc as { category?: string; type?: string; data?: Record<string, unknown> };
          if (!(b.type === "http" || b.category === "fetch" || b.category === "xhr")) continue;
          for (const dk of Object.keys(b.data ?? {})) {
            if (!["method", "http.method", "url", "status_code", "request_body_size", "response_body_size"].includes(dk))
              add("breadcrumbs with bodies", path, `${b.category} breadcrumb has "${dk}"`);
          }
        }
      });
    }
  }
  return findings;
}

// ---- run -----------------------------------------------------------

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Credentials may already be in the environment.
  }

  const baseUrl = process.argv[2];
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    console.error(
      "usage: node --experimental-strip-types scripts/sentry-envelope-check.ts <dev server url>"
    );
    process.exit(2);
  }

  const email = process.env.E2E_MEMBER_EMAIL;
  const password = process.env.E2E_MEMBER_PASSWORD;
  if (!email || !password) {
    console.error("E2E_MEMBER_EMAIL / E2E_MEMBER_PASSWORD are not set. See docs/e2e.md.");
    process.exit(2);
  }

  const captured: Captured[] = [];
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: baseUrl });

  const keepAndAbort = async (req: Request) => {
    const body = req.postDataBuffer();
    if (body) captured.push({ url: req.url(), body });
  };
  // Registered before any page exists, on the context, so every page
  // and every request is covered from the first byte.
  await context.route(/\/monitoring(\?|$)/, async (route) => {
    await keepAndAbort(route.request());
    await route.abort();
  });
  await context.route(/^https?:\/\/([^/]+\.)?sentry\.io\//, async (route) => {
    await keepAndAbort(route.request());
    await route.abort();
  });

  const page = await context.newPage();

  // Sign in through the real form: a server action POST with the
  // email and password in its body.
  await page.goto("/sign-in");
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.getByTestId("user-menu-trigger").waitFor({ timeout: 30_000 });

  // Replay attaches on idle, up to 5 s after hydration.
  await page.waitForTimeout(7_000);

  // A fetch with a query string and a body.
  await page.evaluate(
    async ({ q, b }) => {
      try {
        await fetch(`/api/help?${q}=1&email=someone%40example.com`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: b }),
        });
      } catch {
        // any status is fine; the breadcrumb is what matters
      }
    },
    { q: QUERY_MARKER, b: BODY_MARKER }
  );

  await page.evaluate((msg) => {
    setTimeout(() => {
      throw new Error(msg);
    });
  }, ERROR_MESSAGE);

  // Error event goes at once; replay flushes its buffer after the
  // error. Leave the page open long enough for both.
  await page.waitForTimeout(12_000);

  const cookieValues = (await context.cookies())
    .map((c) => c.value)
    .filter((v) => v.length >= 12);

  await browser.close();

  const items: { where: string; text: string }[] = [];
  const types: string[] = [];
  let sawError = false;
  captured.forEach((c, i) => {
    const env = parseEnvelope(c.body);
    items.push({ where: `envelope#${i}.header`, text: env.header });
    env.items.forEach((it, j) => {
      const type = String(it.header.type);
      types.push(type);
      if (type === "event" && it.text.includes(ERROR_MESSAGE)) sawError = true;
      items.push({ where: `envelope#${i}.${type}#${j}`, text: it.text });
    });
  });

  console.log(`Captured and aborted ${captured.length} request(s) to Sentry.`);
  console.log(`Item types: ${[...new Set(types)].join(", ") || "none"}`);
  console.log(`Error event with "${ERROR_MESSAGE}": ${sawError ? "yes" : "NO"}`);
  console.log(`Replay recording captured: ${types.includes("replay_recording") ? "yes" : "no (replay may not have attached)"}`);
  console.log("");

  const findings = check(items, { email, password, cookieValues });
  const categories = [
    "cookies",
    "headers",
    "IP / user",
    "query strings",
    "bodies",
    "breadcrumbs with bodies",
  ];
  for (const cat of categories) {
    const hits = findings.filter((f) => f.category === cat);
    console.log(`${cat.padEnd(24)} ${hits.length === 0 ? "none" : `${hits.length} FOUND`}`);
    for (const h of hits.slice(0, 5)) console.log(`    ${h.where}: ${h.detail}`);
  }
  console.log("");

  if (!sawError) {
    console.log("FAIL: no error event was captured, so nothing was checked. Is Sentry enabled on this server?");
    process.exit(1);
  }
  if (findings.length > 0) {
    console.log("FAIL");
    process.exit(1);
  }
  console.log("PASS");
}

if (isEntryPoint(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
