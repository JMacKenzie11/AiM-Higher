import "server-only";

// Browserbase (0303): the cloud browsers workers use. Our hosting cannot
// run a browser, so each task gets one from Browserbase, driven over the
// Chrome DevTools Protocol. The key is BROWSERBASE_API_KEY, and the
// project comes from the key, so nothing else is set.
//
// Model calls never go through Browserbase: the worker's thinking is
// Claude on our own Anthropic key, so the privacy answer stays as it is
// for everything but the pages the browser opens.

const API = "https://api.browserbase.com/v1";

function key(): string | null {
  return process.env.BROWSERBASE_API_KEY || null;
}

export function browserbaseConfigured(): boolean {
  return Boolean(key());
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = key();
  if (!apiKey) throw new Error("Browserbase is not set up on this server.");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "X-BB-API-Key": apiKey, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Browserbase ${res.status} on ${path.split("?")[0]}`);
  return (await res.json()) as T;
}

export type BrowserSession = { id: string; connectUrl: string };

// A worker's saved logins (step 2): a Browserbase context keeps the
// browser's cookies between tasks, so a site it signed in to stays
// signed in. One per worker, made on its first task.
export async function createBrowserContext(): Promise<string> {
  const c = await call<{ id: string }>("/contexts", { method: "POST", body: "{}" });
  return c.id;
}

// One browser for one stretch of a task. The timeout is a backstop for
// a run that dies without closing it; a run closes its own browser when
// it ends or stops to wait for its owner.
export async function createBrowserSession(contextId: string | null): Promise<BrowserSession> {
  const s = await call<{ id: string; connectUrl: string }>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      timeout: 360,
      browserSettings: {
        viewport: { width: 1280, height: 800 },
        ...(contextId ? { context: { id: contextId, persist: true } } : {}),
      },
    }),
  });
  return { id: s.id, connectUrl: s.connectUrl };
}

// The live view: an address the run's page shows in a frame while the
// worker works. Null once the browser has closed.
export async function liveViewUrl(sessionId: string): Promise<string | null> {
  try {
    const d = await call<{ debuggerFullscreenUrl?: string }>(`/sessions/${encodeURIComponent(sessionId)}/debug`);
    return d.debuggerFullscreenUrl ?? null;
  } catch {
    return null;
  }
}

export async function releaseBrowserSession(sessionId: string): Promise<void> {
  await call(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    body: JSON.stringify({ status: "REQUEST_RELEASE" }),
  }).catch(() => {});
}

// The recording, on Browserbase's own site. Opens for whoever holds the
// Browserbase account.
export function replayUrl(sessionId: string): string {
  return `https://www.browserbase.com/sessions/${sessionId}`;
}
