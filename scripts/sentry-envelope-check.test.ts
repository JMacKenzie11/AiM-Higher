import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import {
  BODY_MARKER,
  QUERY_MARKER,
  check,
  parseEnvelope,
} from "./sentry-envelope-check";

// The envelope check is only worth running if it can say FAIL. These
// feed it a hand-built envelope in the shape the old config produced,
// and a clean one, and assert it tells them apart.

const secrets = {
  email: "member@example.com",
  password: "correct-horse-battery",
  cookieValues: ["base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0"],
};

function envelope(event: object, recording?: object[]): Buffer {
  const parts: Buffer[] = [
    Buffer.from(JSON.stringify({ event_id: "e", sdk: { name: "sentry.javascript.nextjs" } }) + "\n"),
    Buffer.from(JSON.stringify({ type: "event" }) + "\n"),
    Buffer.from(JSON.stringify(event) + "\n"),
  ];
  if (recording) {
    const payload = Buffer.concat([
      Buffer.from('{"segment_id":0}\n'),
      deflateSync(Buffer.from(JSON.stringify(recording))),
    ]);
    parts.push(
      Buffer.from(JSON.stringify({ type: "replay_recording", length: payload.length }) + "\n"),
      payload,
      Buffer.from("\n")
    );
  }
  return Buffer.concat(parts);
}

function run(raw: Buffer) {
  const env = parseEnvelope(raw);
  const items = [
    { where: "h", text: env.header },
    ...env.items.map((it, i) => ({ where: `${it.header.type}#${i}`, text: it.text })),
  ];
  return { env, findings: check(items, secrets) };
}

describe("sentry-envelope-check", () => {
  it("decodes a compressed replay recording", () => {
    const { env } = run(
      envelope({ message: "x" }, [{ type: 5, data: { tag: "performanceSpan" } }])
    );
    expect(env.items.map((i) => i.header.type)).toEqual(["event", "replay_recording"]);
    expect(env.items[1].text).toContain("performanceSpan");
  });

  it("flags every category in an old-style envelope", () => {
    const { findings } = run(
      envelope(
        {
          message: "sentry envelope check",
          request: {
            url: `http://localhost:3000/dashboard?${QUERY_MARKER}=1`,
            headers: { Referer: "http://localhost:3000/sign-in" },
            cookies: { "sb-abc-auth-token": secrets.cookieValues[0] },
            data: secrets.password,
          },
          user: { ip_address: "{{auto}}" },
          breadcrumbs: [
            {
              category: "fetch",
              type: "http",
              data: { method: "POST", url: "/api/help", body: BODY_MARKER },
            },
          ],
          sdk: { settings: { infer_ip: "auto" } },
        },
        [
          {
            type: 5,
            data: {
              tag: "performanceSpan",
              payload: { description: `/api/help?${QUERY_MARKER}=1` },
            },
          },
        ]
      )
    );
    const cats = new Set(findings.map((f) => f.category));
    expect([...cats].sort()).toEqual(
      [
        "bodies",
        "breadcrumbs with bodies",
        "cookies",
        "headers",
        "IP / user",
        "query strings",
      ].sort()
    );
    // The replay recording's query string is found inside the
    // compressed payload, not only in the event.
    expect(findings.some((f) => f.where.startsWith("replay_recording"))).toBe(true);
  });

  it("finds nothing in a clean envelope, including dev chunk URLs in stack frames", () => {
    const { findings } = run(
      envelope(
        {
          message: "sentry envelope check",
          request: { url: "http://localhost:3000/dashboard" },
          exception: {
            values: [
              {
                stacktrace: {
                  frames: [{ filename: "http://localhost:3000/_next/static/chunks/app.js?v=17" }],
                },
              },
            ],
          },
          breadcrumbs: [
            {
              category: "fetch",
              type: "http",
              data: { method: "POST", url: "/api/help", status_code: 405, request_body_size: 30 },
            },
          ],
          sdk: { settings: { infer_ip: "never" } },
        },
        [{ type: 5, data: { tag: "performanceSpan", payload: { description: "/api/help" } } }]
      )
    );
    expect(findings).toEqual([]);
  });
});
