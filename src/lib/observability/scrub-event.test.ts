import { describe, expect, it } from "vitest";
import {
  BrowserClient,
  createTransport as createBrowserTransport,
  defaultStackParser as browserStackParser,
} from "@sentry/browser";
import {
  NodeClient,
  Scope,
  createTransport,
  defaultStackParser,
  requestDataIntegration,
  type Event,
} from "@sentry/nextjs";
import {
  DATA_COLLECTION,
  scrubEvent,
  scrubReplayRecordingEvent,
  stripQuery,
} from "./scrub-event";

const AUTH_COOKIE = "sb-abcdefghijklmnop-auth-token";
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ";

// Everything the rule forbids, in one event, in every place the SDK
// puts it. Field names are the ones @sentry/core 10.69 writes:
// requestdata.js for event.request/user, browser breadcrumbs.js and
// replay's enrichFetchBreadcrumb for fetch/xhr, node-core
// outgoingFetchRequest.js for server `http` breadcrumbs.
function dirtyEvent(): Event {
  return {
    message: `failed with ${JWT}`,
    request: {
      url: "https://app.example.com/coach?email=jane%40example.com#frag",
      method: "POST",
      query_string: "email=jane%40example.com",
      cookies: { [AUTH_COOKIE]: JWT, theme: "dark" },
      headers: {
        cookie: `${AUTH_COOKIE}=${JWT}`,
        "x-forwarded-for": "203.0.113.7",
        "x-vercel-proxied-for": "203.0.113.7",
        "user-agent": "Mozilla/5.0",
        referer: "https://app.example.com/sign-in?next=%2Fcoach",
      },
      data: '{"message":"I am struggling with my manager"}',
      env: { REMOTE_ADDR: "203.0.113.7" },
    },
    user: { id: "user-1", ip_address: "203.0.113.7", email: "jane@example.com" },
    contexts: {
      response: { status_code: 500, headers: { "set-cookie": "a=b" } },
    },
    breadcrumbs: [
      {
        category: "fetch",
        type: "http",
        data: {
          method: "POST",
          url: "/api/coach?conversation=42",
          status_code: 200,
          request_body_size: 812,
          response_body_size: 4096,
          body: '{"message":"I am struggling with my manager"}',
          request_body: "secret text",
          response_body: "reply text",
        },
      },
      {
        category: "xhr",
        type: "http",
        data: {
          method: "GET",
          url: "https://app.example.com/x?token=abc",
          status_code: 200,
          input: "form body",
        },
      },
      {
        category: "http",
        type: "http",
        data: {
          url: "https://ref.supabase.co/rest/v1/profiles",
          "http.method": "GET",
          "http.query": "?email=eq.jane%40example.com",
          "http.fragment": "#x",
          status_code: 200,
        },
      },
      {
        category: "navigation",
        data: { from: "/sign-in?next=%2Fcoach", to: "/coach?welcome=1" },
      },
    ],
    extra: {
      "server_action_form_data.password": "hunter2",
      server_action_result: { ok: true },
      note: `token ${JWT}`,
    },
  };
}

function assertClean(e: Event) {
  const json = JSON.stringify(e);
  expect(json).not.toContain("203.0.113.7");
  expect(json).not.toContain(AUTH_COOKIE);
  expect(json).not.toContain(JWT);
  expect(json).not.toContain("jane");
  expect(json).not.toContain("struggling");
  expect(json).not.toContain("?");
  expect(json).not.toContain("hunter2");
  expect(json).not.toContain("Mozilla");
}

describe("scrubEvent", () => {
  it("removes cookies, headers, IP, query strings and bodies", () => {
    const e = scrubEvent(dirtyEvent());

    expect(e.request).toEqual({
      url: "https://app.example.com/coach",
      method: "POST",
    });
    expect(e.user).toEqual({ id: "user-1" });
    expect(e.contexts?.response).toEqual({ status_code: 500 });

    const [fetchBc, xhrBc, httpBc, navBc] = e.breadcrumbs!;
    expect(fetchBc.data).toEqual({
      method: "POST",
      url: "/api/coach",
      status_code: 200,
      request_body_size: 812,
      response_body_size: 4096,
    });
    expect(xhrBc.data).toEqual({
      method: "GET",
      url: "https://app.example.com/x",
      status_code: 200,
    });
    expect(httpBc.data).toEqual({
      url: "https://ref.supabase.co/rest/v1/profiles",
      "http.method": "GET",
      status_code: 200,
    });
    expect(navBc.data).toEqual({ from: "/sign-in", to: "/coach" });

    expect(e.extra).toEqual({ note: "token [JWT_REDACTED]" });
    expect(e.message).toBe("failed with [JWT_REDACTED]");
    assertClean(e);
  });

  it("drops a user that has no id rather than keeping the IP", () => {
    const e = scrubEvent({ user: { ip_address: "{{auto}}" } });
    expect(e.user).toBeUndefined();
  });

  it("scrubs transaction span data", () => {
    const e = scrubEvent({
      type: "transaction",
      contexts: {
        trace: {
          trace_id: "t",
          span_id: "s",
          data: {
            "url.full": "https://app.example.com/coach?x=1",
            "url.query": "?x=1",
            "http.request.header.cookie.theme": "dark",
            "http.request.header.user_agent": "Mozilla/5.0",
            "http.request.body.data": "struggling",
            "user.ip_address": "203.0.113.7",
            "http.method": "GET",
          },
        },
      },
      spans: [
        {
          span_id: "c",
          trace_id: "t",
          start_timestamp: 0,
          description: "GET https://ref.supabase.co/rest/v1/p?email=eq.jane",
          data: {
            url: "https://ref.supabase.co/rest/v1/p?email=eq.jane",
            "http.url": "https://ref.supabase.co/rest/v1/p?email=eq.jane",
            "http.query": "?email=eq.jane",
            "http.response.header.set_cookie": "a",
          },
        },
      ],
    } as Event);
    expect(e.contexts?.trace?.data).toEqual({
      "url.full": "https://app.example.com/coach",
      "http.method": "GET",
    });
    expect(e.spans![0].description).toBe("GET https://ref.supabase.co/rest/v1/p");
    expect(e.spans![0].data).toEqual({
      url: "https://ref.supabase.co/rest/v1/p",
      "http.url": "https://ref.supabase.co/rest/v1/p",
    });
    assertClean(e);
  });

  it("strips query strings from a replay event's url list", () => {
    const e = scrubEvent({
      type: "replay_event",
      urls: ["https://app.example.com/a?b=c", "https://app.example.com/d"],
    } as Event);
    expect((e as { urls: string[] }).urls).toEqual([
      "https://app.example.com/a",
      "https://app.example.com/d",
    ]);
  });
});

describe("scrubReplayRecordingEvent", () => {
  it("strips query strings and drops network detail from performance spans", () => {
    const ev = scrubReplayRecordingEvent({
      type: 5,
      timestamp: 0,
      data: {
        tag: "performanceSpan",
        payload: {
          op: "resource.fetch",
          description: "https://app.example.com/api/coach?c=42",
          data: {
            method: "POST",
            statusCode: 200,
            request: { size: 10, headers: { cookie: "x" }, body: "struggling" },
            response: { size: 20, body: "reply" },
          },
        },
      },
    });
    expect(JSON.stringify(ev)).not.toMatch(/\?|struggling|reply|cookie/);
  });

  it("scrubs breadcrumbs recorded into the replay", () => {
    const ev = scrubReplayRecordingEvent({
      type: 5,
      timestamp: 0,
      data: {
        tag: "breadcrumb",
        payload: {
          category: "fetch",
          data: { url: "/api/coach?c=1", method: "POST", body: "struggling" },
        },
      },
    });
    expect(JSON.stringify(ev)).not.toMatch(/\?|struggling/);
  });
});

describe("stripQuery", () => {
  it("cuts at ? or #", () => {
    expect(stripQuery("/a?b#c")).toBe("/a");
    expect(stripQuery("/a#c?d")).toBe("/a");
    expect(stripQuery("/a")).toBe("/a");
  });
});

// The SDK's own view of our options. resolveDataCollectionOptions is
// not exported from @sentry/core, so read what a real client resolved.
describe("effective dataCollection", () => {
  const OFF = {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    stackFrameVariables: false,
    frameContextLines: 5,
  };

  const noTransport = () =>
    createTransport({ recordDroppedEvent: () => undefined }, () =>
      Promise.resolve({})
    );

  it("server/edge client resolves every category off", () => {
    const client = new NodeClient({
      transport: noTransport,
      stackParser: defaultStackParser,
      integrations: [],
      sendDefaultPii: false,
      dataCollection: DATA_COLLECTION,
    });
    expect(client.getDataCollectionOptions()).toEqual(OFF);
  });

  it("browser client resolves every category off and tells Sentry not to infer IP", () => {
    const client = new BrowserClient({
      transport: noTransport,
      stackParser: browserStackParser,
      integrations: [],
      sendDefaultPii: false,
      dataCollection: DATA_COLLECTION,
    });
    expect(client.getDataCollectionOptions()).toEqual(OFF);
    expect(client.getOptions()._metadata?.sdk?.settings?.infer_ip).toBe("never");
  });

  it("the old `dataCollection: {}` really did turn everything on (the bug)", () => {
    const client = new BrowserClient({
      transport: noTransport,
      stackParser: browserStackParser,
      integrations: [],
      dataCollection: {},
    });
    const dc = client.getDataCollectionOptions();
    expect(dc.userInfo).toBe(true);
    expect(dc.cookies).toBe(true);
    expect(dc.httpBodies).toHaveLength(4);
    expect(client.getOptions()._metadata?.sdk?.settings?.infer_ip).toBe("auto");
  });
});

// End to end through the SDK's event pipeline, with an in-memory
// transport. No DSN host is contacted: the transport below is the
// only thing that sees the envelope.
describe("pipeline: requestDataIntegration then our beforeSend", () => {
  function serverClient(
    sent: string[],
    extra: Partial<ConstructorParameters<typeof NodeClient>[0]>
  ) {
    const client = new NodeClient({
      dsn: "https://public@o0.ingest.example.invalid/0",
      transport: (opts) =>
        createTransport(opts, (req) => {
          sent.push(
            typeof req.body === "string"
              ? req.body
              : new TextDecoder().decode(req.body)
          );
          return Promise.resolve({ statusCode: 200 });
        }),
      stackParser: defaultStackParser,
      integrations: [requestDataIntegration()],
      ...extra,
    });
    client.init();
    return client;
  }

  function requestScope(client: NodeClient) {
    const scope = new Scope();
    scope.setClient(client);
    scope.setSDKProcessingMetadata({
      normalizedRequest: {
        url: "https://app.example.com/coach?email=jane%40example.com",
        method: "POST",
        query_string: "email=jane%40example.com",
        headers: {
          cookie: `${AUTH_COOKIE}=${JWT}`,
          "x-forwarded-for": "203.0.113.7",
          "x-vercel-proxied-for": "203.0.113.7",
          "user-agent": "Mozilla/5.0",
        },
        data: '{"message":"I am struggling with my manager"}',
      },
      ipAddress: "203.0.113.7",
    });
    return scope;
  }

  // The server config on main before this change: no dataCollection,
  // sendDefaultPii left at its default. This is the evidence for what
  // old server events carried.
  it("OLD server config: cookies, headers, query string and body all reach the envelope", async () => {
    const sent: string[] = [];
    const client = serverClient(sent, {});
    client.captureException(new Error("boom"), {}, requestScope(client));
    await client.flush(1000);
    const event = JSON.parse(sent[0].split("\n")[2]);
    expect(event.request.cookies[AUTH_COOKIE]).toBe(JWT);
    expect(event.request.headers.cookie).toContain(AUTH_COOKIE);
    expect(event.request.headers["x-vercel-proxied-for"]).toBe("203.0.113.7");
    expect(event.request.headers["x-forwarded-for"]).toBeUndefined();
    expect(event.request.query_string).toBe("email=jane%40example.com");
    expect(event.request.data).toContain("struggling");
    expect(event.user?.ip_address).toBeUndefined();
  });

  it("a server event built from a real-looking request carries none of it", async () => {
    const sent: string[] = [];
    const client = serverClient(sent, {
      sendDefaultPii: false,
      dataCollection: DATA_COLLECTION,
      beforeSend: (e) => scrubEvent(e),
    });
    client.captureException(new Error("boom"), {}, requestScope(client));
    await client.flush(1000);

    expect(sent).toHaveLength(1);
    const envelope = sent[0];
    expect(envelope).toContain("boom");
    expect(envelope).not.toContain("203.0.113.7");
    expect(envelope).not.toContain(AUTH_COOKIE);
    expect(envelope).not.toContain("struggling");
    expect(envelope).not.toContain("jane");
    expect(envelope).not.toContain("Mozilla");
  });

  it("browser client: scrubbed and flagged infer_ip never", async () => {
    const sent: string[] = [];
    const client = new BrowserClient({
      dsn: "https://public@o0.ingest.example.invalid/0",
      transport: (opts) =>
        createBrowserTransport(opts, (req) => {
          sent.push(
            typeof req.body === "string"
              ? req.body
              : new TextDecoder().decode(req.body)
          );
          return Promise.resolve({ statusCode: 200 });
        }),
      stackParser: browserStackParser,
      integrations: [],
      sendDefaultPii: false,
      dataCollection: DATA_COLLECTION,
      beforeSend: (e) => scrubEvent(e),
    });
    client.init();
    const scope = new Scope();
    scope.setClient(client);
    scope.addBreadcrumb({
      category: "fetch",
      type: "http",
      data: {
        method: "POST",
        url: "/api/coach?c=1",
        status_code: 200,
        body: "I am struggling",
      },
    });
    scope.setUser({ ip_address: "{{auto}}" });
    client.captureException(new Error("boom"), {}, scope);
    await client.flush(1000);

    expect(sent).toHaveLength(1);
    const envelope = sent[0];
    expect(envelope).toContain('"infer_ip":"never"');
    expect(envelope).not.toContain("struggling");
    expect(envelope).not.toContain("?c=1");
    expect(envelope).not.toContain("{{auto}}");
  });
});
