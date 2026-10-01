// What Sentry is allowed to carry, shared by all three runtimes:
// sentry.server.config.ts (Node), sentry.edge.config.ts (Edge) and
// src/instrumentation-client.ts (browser).
//
// The rule: no IP addresses, cookies, headers, query strings, or
// request and response bodies, on any runtime. Two layers enforce it.
//
// 1. DATA_COLLECTION stops the SDK collecting them in the first place.
//    Every key is set explicitly. In @sentry/core 10.69, passing ANY
//    dataCollection object (even `{}`) switches the base defaults to
//    all-on (resolveDataCollectionOptions.js, `DEFAULTS`), so a key we
//    leave out is a key that is collected.
//
// 2. scrubEvent() runs on every event on its way out (beforeSend,
//    beforeSendTransaction and an event processor that also sees
//    replay events), and removes the same fields again. Several
//    capture paths ignore dataCollection entirely: the Node HTTP
//    integration buffers incoming request bodies whatever it says,
//    and outgoing-request breadcrumbs always carry `http.query`. The
//    scrubber is what makes the rule hold regardless of what an SDK
//    upgrade starts collecting.
//
// It also redacts anything that looks like a JWT from free text.
// Supabase session tokens are `eyJ…` triple-dot strings.
//
// We only touch fields Sentry guarantees are strings or plain data.
// Walking the whole event blindly overflows the stack on deep
// structures like stack-frame `vars`, which is what caused
// JAVASCRIPT-NEXTJS-2 the first time a scrubber was deployed.

import type { Breadcrumb, Event, NodeOptions } from "@sentry/nextjs";

type DataCollection = NonNullable<NodeOptions["dataCollection"]>;

// `Required<…>` makes this fail to compile if an SDK upgrade adds a
// category we have not decided about. `queryParams` is the deprecated
// alias of `urlQueryParams`.
export const DATA_COLLECTION: Required<Omit<DataCollection, "queryParams">> = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: false, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  stackFrameVariables: false,
  // Lines of our own source code around each stack frame. Not
  // personal data, and the thing that makes a stack trace readable.
  frameContextLines: 5,
};

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

export function redact(s: string | undefined): string | undefined {
  return s ? s.replace(JWT, "[JWT_REDACTED]") : s;
}

/** Drop everything from the first `?` or `#`. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

function scrubShallow(obj: Record<string, unknown> | undefined) {
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") obj[k] = redact(v);
  }
}

// Keys a URL can sit under, in breadcrumbs and span data.
const URL_KEYS = ["url", "from", "to", "http.url", "url.full", "http.target"];

// Keys that are a query string, a fragment, a header, a body, a cookie
// or an address, in breadcrumb data and span attributes.
const DROP_KEY = [
  /^http\.query$/,
  /^http\.fragment$/,
  /^url\.query$/,
  /^url\.fragment$/,
  /^http\.(request|response)\.header\./,
  /^http\.(request|response)\.body\.data$/,
  /^http\.(request|response)\.cookies?/,
  /^(user\.ip_address|client\.address|net\.peer\.ip|net\.sock\.peer\.addr)$/,
  /(^|\.)(body|input|output)$/,
];

function scrubKeyValues(data: Record<string, unknown> | undefined) {
  if (!data) return;
  for (const key of Object.keys(data)) {
    if (DROP_KEY.some((re) => re.test(key))) {
      delete data[key];
      continue;
    }
    const v = data[key];
    if (typeof v === "string") {
      data[key] = URL_KEYS.includes(key) ? stripQuery(v) : redact(v);
    }
  }
}

// An HTTP breadcrumb (browser fetch/xhr, server outgoing `http`) keeps
// these and nothing else. The browser writes method, url, status_code,
// and (with replay attached) request_body_size / response_body_size;
// the server writes url, http.method, status_code, http.query and
// http.fragment. Sizes are numbers, not content.
const HTTP_BREADCRUMB_KEYS = new Set([
  "method",
  "http.method",
  "url",
  "status_code",
  "request_body_size",
  "response_body_size",
]);

export function scrubBreadcrumb(bc: Breadcrumb): Breadcrumb {
  bc.message = redact(bc.message);
  const isHttp =
    bc.type === "http" ||
    bc.category === "fetch" ||
    bc.category === "xhr" ||
    bc.category === "http";
  if (isHttp && bc.data) {
    for (const key of Object.keys(bc.data)) {
      if (!HTTP_BREADCRUMB_KEYS.has(key)) delete bc.data[key];
    }
  }
  scrubKeyValues(bc.data);
  return bc;
}

type SpanLike = { data?: Record<string, unknown>; description?: string };

function scrubSpan(span: SpanLike | undefined) {
  if (!span) return;
  scrubKeyValues(span.data);
  if (typeof span.description === "string") {
    // "GET https://host/path?x=1" -> "GET https://host/path"
    span.description = stripQuery(span.description);
  }
}

/**
 * Remove IP addresses, cookies, headers, query strings and bodies from
 * any Sentry event: errors, transactions, and replay events. Mutates
 * and returns the event.
 */
export function scrubEvent<T extends Event>(event: T): T {
  event.message = redact(event.message);
  for (const ex of event.exception?.values ?? []) {
    ex.value = redact(ex.value);
  }

  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
    delete event.request.env;
    if (typeof event.request.url === "string") {
      event.request.url = stripQuery(event.request.url);
    }
  }

  if (event.user) {
    const id = event.user.id;
    if (id !== undefined && id !== null && id !== "") {
      event.user = { id };
    } else {
      delete event.user;
    }
  }

  const contexts = event.contexts as Record<string, Record<string, unknown> | undefined> | undefined;
  if (contexts?.response) {
    delete contexts.response.headers;
    delete contexts.response.cookies;
    delete contexts.response.data;
  }

  for (const bc of event.breadcrumbs ?? []) scrubBreadcrumb(bc);

  if (event.extra) {
    // withServerActionInstrumentation writes the action's form fields
    // and return value here. We do not call it today; if anyone does,
    // those are request and response bodies.
    for (const key of Object.keys(event.extra)) {
      if (key.startsWith("server_action_")) delete event.extra[key];
    }
    scrubShallow(event.extra);
  }
  scrubShallow(event.tags as Record<string, unknown> | undefined);

  // Transactions: the root span's data lives on contexts.trace, the
  // children on event.spans.
  scrubSpan(contexts?.trace as SpanLike | undefined);
  for (const span of event.spans ?? []) {
    scrubSpan(span as unknown as SpanLike);
  }

  // Replay events list every page URL visited in the segment.
  const replay = event as T & { urls?: unknown };
  if (Array.isArray(replay.urls)) {
    replay.urls = replay.urls.map((u) => (typeof u === "string" ? stripQuery(u) : u));
  }

  return event;
}

/**
 * Runs scrubEvent as an event processor, so replay events (which do
 * not pass through beforeSend) are covered too. Registered alongside
 * beforeSend/beforeSendTransaction, which stay as the last word.
 */
export function scrubPersonalDataIntegration() {
  return {
    name: "ScrubPersonalData",
    processEvent(event: Event) {
      return scrubEvent(event);
    },
  };
}

/**
 * Session Replay recording events. Only "custom" rrweb events reach
 * this hook (performance spans for network requests and navigation,
 * and breadcrumbs); DOM snapshots do not, and those are masked by
 * replay's defaults (maskAllText, maskAllInputs, blockAllMedia).
 */
export function scrubReplayRecordingEvent<
  T extends { type: number; data?: unknown },
>(event: T): T {
  const data = event.data as
    | { tag?: string; payload?: Record<string, unknown> }
    | undefined;
  const payload = data?.payload;
  if (!payload) return event;
  if (data.tag === "performanceSpan") {
    if (typeof payload.description === "string") {
      payload.description = stripQuery(payload.description);
    }
    // Network spans carry { method, statusCode, request, response };
    // request/response hold headers and bodies only for URLs on
    // networkDetailAllowUrls, which we leave empty. Drop them anyway.
    const d = payload.data as Record<string, unknown> | undefined;
    if (d) {
      delete d.request;
      delete d.response;
      scrubKeyValues(d);
    }
  } else if (data.tag === "breadcrumb") {
    scrubBreadcrumb(payload as Breadcrumb);
  }
  return event;
}
