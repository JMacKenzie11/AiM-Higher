import type { BrowserContext, Locator, Page } from "playwright-core";
import { checkUrl, keySequence, rankLines, toModifiers, toPlaywrightChord } from "./browser-keys";
import { LIST_PAGE_SCRIPT, PRESS_TARGET_SCRIPT } from "./page-script";
import { checkEnter, checkPress, domainOf, type PressCheck, type PressTarget } from "./press";

// THE WORKER'S HANDS (0303). Claude's browser tool
// (browser_toolset_20260801) decides each step; it never touches the
// browser itself. This carries each step out in the cloud browser over
// Playwright and returns what the tool's spec says the result holds:
// text, an image, or the list of tabs.
//
// The spec: platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool.
// The four optional members (javascript_exec, file_upload, read_console,
// read_network) stay off, as the spec advises, and are answered with an
// error if named anyway.

export const VIEWPORT = { width: 1280, height: 800 };

type TextBlock = { type: "text"; text: string };
type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } };
type Tab = { tab_id: string; title: string; url: string; active?: boolean };
type BrowserStateBlock = {
  type: "browser_state";
  tabs: Tab[];
  state_changes?: Array<{ type: "tab_opened"; tab_id: string }>;
};
export type ResultBlock = TextBlock | ImageBlock | BrowserStateBlock;
export type MemberResult = { content: ResultBlock[]; is_error?: boolean; needsApproval?: Approval };

// A press the worker must ask its owner about first (press.ts).
export type Approval = { action: string; domain: string; alwaysAsks: boolean };
// Says whether a press may go ahead without asking: the worker's
// "Edit records in websites" switch and its Allow always rules. Never
// asked about a press that always asks.
export type PressGate = (domain: string) => boolean;

type CoordinateTarget = { type: "coordinate"; x: number; y: number };
type RefTarget = { type: "ref"; ref: string };
type Target = CoordinateTarget | RefTarget;

const ACTION_TIMEOUT = 8_000;
const NAV_TIMEOUT = 30_000;
const TEXT_MAX = 50_000;

const text = (t: string): MemberResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): MemberResult => ({ content: [{ type: "text", text: t.startsWith("Error") ? t : `Error: ${t}` }], is_error: true });

export const NOT_EXECUTED = "Not executed: an earlier action in this turn failed.";

export class WorkerBrowser {
  private tabIds = new WeakMap<Page, string>();
  private refNext = new WeakMap<Page, number>();
  private tabCount = 0;
  private current: Page;
  private opened: string[] = [];

  private approvedOnce = false;
  private oneFree: { action: string; domain: string } | null = null;

  // The owner approved this press on this site while the browser was
  // closed: the next press that matches it goes through once.
  allowOnce(action: string, domain: string) {
    this.oneFree = { action, domain };
  }

  constructor(private context: BrowserContext, first: Page, private gate: PressGate = () => false) {
    this.current = first;
    this.idFor(first);
    context.on("page", (p) => {
      // A link that opens a new tab: it becomes the current tab, and the
      // next result says so.
      this.opened.push(this.idFor(p));
      this.current = p;
    });
  }

  private idFor(p: Page): string {
    let id = this.tabIds.get(p);
    if (!id) {
      id = `tab-${++this.tabCount}`;
      this.tabIds.set(p, id);
    }
    return id;
  }

  private pages(): Page[] {
    return this.context.pages().filter((p) => !p.isClosed());
  }

  private pageFor(tabId: unknown): Page | null {
    if (tabId === undefined || tabId === null || tabId === "") {
      if (this.current.isClosed()) this.current = this.pages()[0] ?? this.current;
      return this.current.isClosed() ? null : this.current;
    }
    return this.pages().find((p) => this.idFor(p) === tabId) ?? null;
  }

  async state(): Promise<BrowserStateBlock> {
    const tabs: Tab[] = [];
    for (const p of this.pages()) {
      const tab: Tab = { tab_id: this.idFor(p), title: (await p.title().catch(() => "")).slice(0, 4000), url: p.url().slice(0, 4000) };
      if (p === this.current) tab.active = true;
      tabs.push(tab);
    }
    if (tabs.length > 0 && !tabs.some((t) => t.active)) tabs[0].active = true;
    const block: BrowserStateBlock = { type: "browser_state", tabs };
    if (this.opened.length > 0) {
      block.state_changes = this.opened.map((tab_id) => ({ type: "tab_opened" as const, tab_id }));
      this.opened = [];
    }
    return block;
  }

  currentUrl(): string {
    return this.current.isClosed() ? "" : this.current.url();
  }

  private locate(page: Page, ref: string): Locator {
    return page.locator(`[data-aims-ref="${ref.replace(/[^a-z0-9_]/gi, "")}"]`).first();
  }

  private async stale(page: Page, ref: string): Promise<boolean> {
    return (await this.locate(page, ref).count()) === 0;
  }

  private staleError(ref: string) {
    return fail(`Error: ${ref} is stale or not found on the current page. Re-read the page to get fresh references.`);
  }

  private async settle(page: Page) {
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
  }

  private async screenshot(page: Page, clip?: { x: number; y: number; width: number; height: number }): Promise<MemberResult> {
    const buf = await page.screenshot({ type: "jpeg", quality: 70, ...(clip ? { clip } : {}) });
    return { content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } }] };
  }

  private async listPage(page: Page, filter: string, depth: number, root?: string) {
    const start = this.refNext.get(page) ?? 1;
    const out = (await page.evaluate(`${LIST_PAGE_SCRIPT}(${JSON.stringify({ next: start, filter, depth, root: root ?? null })})`)) as
      | { lines: string[]; next: number; truncated: boolean }
      | { error: string; next: number };
    this.refNext.set(page, out.next);
    return out;
  }

  // Hold a press that changes something until the owner says yes.
  private async held(page: Page, check: PressCheck): Promise<MemberResult | null> {
    if (!check || this.approvedOnce) return null;
    const domain = domainOf(page.url());
    if (this.oneFree && this.oneFree.action === check.action && this.oneFree.domain === domain) {
      this.oneFree = null;
      return null;
    }
    if (!check.alwaysAsks && this.gate(domain)) return null;
    return {
      content: [{ type: "text", text: `Waiting for the owner to approve: ${check.action} on ${domain || "this page"}.` }],
      needsApproval: { action: check.action, domain, alwaysAsks: check.alwaysAsks },
    };
  }

  private async pressTarget(page: Page, where: { ref?: string; x?: number; y?: number; focused?: boolean }) {
    return (await page.evaluate(`${PRESS_TARGET_SCRIPT}(${JSON.stringify(where)})`)) as (PressTarget & { submitText: string | null }) | null;
  }

  private async click(page: Page, target: Target, opts: { button?: "left" | "right" | "middle"; clickCount?: number; modifiers?: string }) {
    const modifiers = toModifiers(opts.modifiers);
    if (target?.type === "ref") {
      if (await this.stale(page, target.ref)) return this.staleError(target.ref);
      const t = await this.pressTarget(page, { ref: target.ref });
      if (opts.button !== "right") {
        const hold = t ? await this.held(page, checkPress(t)) : null;
        if (hold) return hold;
      }
      await this.locate(page, target.ref).click({ button: opts.button, clickCount: opts.clickCount, modifiers, timeout: ACTION_TIMEOUT });
      await this.settle(page);
      return text(`Clicked ${t?.text ? `"${t.text.slice(0, 80)}" ` : ""}(${target.ref}).`);
    }
    if (target?.type === "coordinate") {
      const t = await this.pressTarget(page, { x: target.x, y: target.y });
      if (opts.button !== "right") {
        const hold = t ? await this.held(page, checkPress(t)) : null;
        if (hold) return hold;
      }
      for (const m of modifiers) await page.keyboard.down(m);
      await page.mouse.click(target.x, target.y, { button: opts.button, clickCount: opts.clickCount });
      for (const m of modifiers.reverse()) await page.keyboard.up(m);
      await this.settle(page);
      return text(`Clicked ${t?.text ? `"${t.text.slice(0, 80)}" ` : ""}at (${target.x}, ${target.y}).`);
    }
    return fail("Error: a click needs a target.");
  }

  // One member call. Never throws: a failure is an error result.
  // Types a saved password into the field that has focus. The value is
  // never returned, logged or described.
  async typeSecret(value: string): Promise<MemberResult> {
    try {
      const page = this.pageFor(undefined);
      if (!page) return fail("Error: no tab is open.");
      const focused = await page.evaluate(`(function(){var e=document.activeElement;return !!e && (e.tagName==="INPUT"||e.tagName==="TEXTAREA"||e.isContentEditable);})()`);
      if (!focused) return fail("Error: click the password field first, then type the saved password.");
      await page.keyboard.type(value, { delay: 15 });
      return text("Typed the saved password.");
    } catch {
      return fail("Error: the saved password could not be typed.");
    }
  }

  // `approved` is the owner's yes to this one call, after it was held.
  async run(name: string, input: Record<string, unknown>, approved = false): Promise<MemberResult> {
    this.approvedOnce = approved;
    try {
      return await this.member(name, input ?? {});
    } catch (err) {
      const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return fail(`Error: ${message.slice(0, 500)}`);
    }
  }

  private async member(name: string, input: Record<string, unknown>): Promise<MemberResult> {
    // Tab management needs no page of its own.
    if (name === "list_tabs" || name === "new_tab" || name === "switch_tab" || name === "close_tab") {
      if (name === "new_tab") {
        const p = await this.context.newPage();
        await p.setViewportSize(VIEWPORT).catch(() => {});
        this.opened = this.opened.filter((id) => id !== this.idFor(p));
        this.current = p;
      } else if (name === "switch_tab" || name === "close_tab") {
        const p = this.pageFor(input.tab_id);
        if (!p) return fail(`Error: no tab ${String(input.tab_id)}.`);
        if (name === "switch_tab") {
          this.current = p;
          await p.bringToFront().catch(() => {});
        } else {
          await p.close();
          this.current = this.pages()[0] ?? this.current;
        }
      }
      return { content: [await this.state()] };
    }

    const page = this.pageFor(input.tab_id);
    if (!page) return fail(input.tab_id ? `Error: no tab ${String(input.tab_id)}.` : "Error: no tab is open. Open one with new_tab.");

    switch (name) {
      case "navigate": {
        const where = String(input.url ?? "");
        if (where === "back") await page.goBack({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
        else if (where === "forward") await page.goForward({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
        else if (where === "reload") await page.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
        else {
          const checked = checkUrl(where);
          if (!checked.ok) return fail(checked.error);
          await page.goto(checked.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
        }
        // A redirect can land somewhere the address check would refuse.
        const landed = checkUrl(page.url());
        if (!landed.ok && page.url() !== "about:blank") {
          await page.goto("about:blank").catch(() => {});
          return fail(landed.error);
        }
        return text(`Opened ${page.url()} (${(await page.title().catch(() => "")) || "no title"}).`);
      }
      case "screenshot":
        return this.screenshot(page);
      case "zoom": {
        const r = input.region as number[] | undefined;
        if (!Array.isArray(r) || r.length !== 4) return fail("Error: zoom needs region [x0, y0, x1, y1].");
        const [x0, y0, x1, y1] = r.map(Number);
        if (!(x1 > x0 && y1 > y0)) return fail("Error: the region's second corner must be below and right of the first.");
        return this.screenshot(page, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
      }
      case "left_click":
        return this.click(page, input.target as Target, { modifiers: input.modifiers as string | undefined });
      case "right_click":
        return this.click(page, input.target as Target, { button: "right", modifiers: input.modifiers as string | undefined });
      case "middle_click":
        return this.click(page, input.target as Target, { button: "middle", modifiers: input.modifiers as string | undefined });
      case "double_click":
        return this.click(page, input.target as Target, { clickCount: 2, modifiers: input.modifiers as string | undefined });
      case "triple_click":
        return this.click(page, input.target as Target, { clickCount: 3, modifiers: input.modifiers as string | undefined });
      case "hover": {
        const t = input.target as Target;
        if (t?.type === "ref") {
          if (await this.stale(page, t.ref)) return this.staleError(t.ref);
          await this.locate(page, t.ref).hover({ timeout: ACTION_TIMEOUT });
          return text(`Hovering over ${t.ref}.`);
        }
        if (t?.type === "coordinate") {
          await page.mouse.move(t.x, t.y);
          return text(`Hovering at (${t.x}, ${t.y}).`);
        }
        return fail("Error: hover needs a target.");
      }
      case "left_click_drag": {
        const from = input.from as CoordinateTarget;
        const to = input.target as CoordinateTarget;
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 10 });
        await page.mouse.up();
        return text(`Dragged from (${from.x}, ${from.y}) to (${to.x}, ${to.y}).`);
      }
      case "left_mouse_down":
      case "left_mouse_up":
      case "mouse_move": {
        const t = input.target as CoordinateTarget;
        await page.mouse.move(t.x, t.y);
        if (name === "left_mouse_down") await page.mouse.down();
        if (name === "left_mouse_up") await page.mouse.up();
        return text(`Done at (${t.x}, ${t.y}).`);
      }
      case "scroll": {
        const t = input.target as CoordinateTarget;
        const amount = Math.min(10, Math.max(1, Number(input.scroll_amount ?? 3)));
        const px = amount * 100;
        const dir = String(input.scroll_direction);
        await page.mouse.move(t.x, t.y);
        await page.mouse.wheel(dir === "left" ? -px : dir === "right" ? px : 0, dir === "up" ? -px : dir === "down" ? px : 0);
        await page.waitForTimeout(300);
        return text(`Scrolled ${dir}.`);
      }
      case "scroll_to": {
        const t = input.target as RefTarget;
        if (t?.type !== "ref") return fail("Error: scroll_to needs a ref.");
        if (await this.stale(page, t.ref)) return this.staleError(t.ref);
        await this.locate(page, t.ref).scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT });
        return text(`Scrolled to ${t.ref}.`);
      }
      case "type": {
        const typed = String(input.text ?? "");
        const secret = await page.evaluate(`(function(){var e=document.activeElement;return !!e && (e.getAttribute("type")||"").toLowerCase()==="password";})()`).catch(() => false);
        await page.keyboard.type(typed, { delay: 15 });
        return text(secret ? "Typed into a password field." : `Typed "${typed.slice(0, 80)}".`);
      }
      case "key": {
        const repeat = Math.min(100, Math.max(1, Number(input.repeat ?? 1)));
        const keys = keySequence(String(input.text ?? ""));
        if (keys.length === 0) return fail("Error: key needs a key name.");
        if (keys.some((k) => k === "Enter")) {
          const t = await this.pressTarget(page, { focused: true });
          const hold = t ? await this.held(page, checkEnter(t)) : null;
          if (hold) return hold;
        }
        for (let i = 0; i < repeat; i++) for (const k of keys) await page.keyboard.press(k);
        await this.settle(page);
        return text(`Pressed ${String(input.text)}${repeat > 1 ? ` ${repeat} times` : ""}.`);
      }
      case "hold_key": {
        const k = toPlaywrightChord(String(input.text ?? ""));
        const seconds = Math.min(30, Math.max(0, Number(input.duration ?? 0)));
        await page.keyboard.down(k);
        await page.waitForTimeout(seconds * 1000);
        await page.keyboard.up(k);
        return text(`Held ${String(input.text)} for ${seconds} seconds.`);
      }
      case "wait": {
        const seconds = Math.min(30, Math.max(0, Number(input.duration ?? 1)));
        await page.waitForTimeout(seconds * 1000);
        return text(`Waited ${seconds} seconds.`);
      }
      case "read_page": {
        const filter = input.filter === "interactive" || input.filter === "all" ? String(input.filter) : "visible";
        const depth = Math.max(1, Number(input.depth ?? 15));
        const out = await this.listPage(page, filter, depth, input.ref ? String(input.ref) : undefined);
        if ("error" in out) return fail(out.error);
        const body = out.lines.length ? out.lines.join("\n") : "Nothing on this part of the page.";
        return text(out.truncated ? `${body}\n(Output stopped at 50,000 characters. Read a smaller part with ref, or filter "interactive".)` : body);
      }
      case "find": {
        const out = await this.listPage(page, "all", 15);
        if ("error" in out) return fail(out.error);
        const hits = rankLines(out.lines, String(input.query ?? ""));
        return text(hits.length ? hits.join("\n") : `Nothing on the page matches "${String(input.query ?? "")}".`);
      }
      case "get_page_text": {
        const body = await page.evaluate(`(function () {
          var el = document.querySelector("main, [role=main], article") || document.body;
          return (el.innerText || "").replace(/\\n{3,}/g, "\\n\\n");
        })()`);
        const t = String(body ?? "");
        return text(t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX)}\n(Text stopped at 50,000 characters.)` : t || "The page has no text.");
      }
      case "form_input": {
        const t = input.target as RefTarget;
        if (t?.type !== "ref") return fail("Error: form_input needs a ref.");
        if (await this.stale(page, t.ref)) return this.staleError(t.ref);
        const loc = this.locate(page, t.ref);
        const kind = await loc.evaluate((el) => {
          const tag = el.tagName.toLowerCase();
          const type = (el.getAttribute("type") || "").toLowerCase();
          return tag === "select" ? "select" : type === "checkbox" || type === "radio" ? "check" : "fill";
        });
        const value = input.value;
        if (kind === "select") await loc.selectOption({ label: String(value) }, { timeout: ACTION_TIMEOUT }).catch(() => loc.selectOption(String(value), { timeout: ACTION_TIMEOUT }));
        else if (kind === "check") await loc.setChecked(value === true || value === "true", { timeout: ACTION_TIMEOUT });
        else await loc.fill(String(value ?? ""), { timeout: ACTION_TIMEOUT });
        const named = await this.pressTarget(page, { ref: t.ref }).catch(() => null);
        const kindOfValue = kind === "fill" && /password/i.test(named?.type ?? "") ? "" : ` to "${String(value ?? "").slice(0, 60)}"`;
        return text(`Set ${named?.text && kind !== "fill" ? `"${named.text.slice(0, 60)}"` : t.ref}${kindOfValue}.`);
      }
      case "javascript_exec":
      case "file_upload":
      case "read_console":
      case "read_network":
        return fail(`Error: ${name} is not available to this worker.`);
      default:
        return fail(`Error: ${name} is not a browser action this worker knows.`);
    }
  }
}

// A one-line account of a member call, for the step list on the run's
// page. Never the text typed into a password field: the field is not
// known here, so typing is summarised by length alone.
export function describeAction(name: string, input: Record<string, unknown>): string {
  const target = input.target as Target | undefined;
  const where = target?.type === "ref" ? target.ref : target?.type === "coordinate" ? `(${target.x}, ${target.y})` : "";
  switch (name) {
    case "navigate":
      return `Opened ${String(input.url ?? "")}`;
    case "screenshot":
      return "Looked at the page";
    case "zoom":
      return "Looked closer at part of the page";
    case "read_page":
      return "Read the page";
    case "find":
      return `Looked for "${String(input.query ?? "")}"`;
    case "get_page_text":
      return "Read the page's text";
    case "left_click":
    case "double_click":
    case "triple_click":
    case "right_click":
    case "middle_click":
      return `Clicked ${where}`.trim();
    case "hover":
      return `Pointed at ${where}`.trim();
    case "type":
      return `Typed ${String(input.text ?? "").length} characters`;
    case "key":
      return `Pressed ${String(input.text ?? "")}`;
    case "form_input":
      return `Filled in ${where}`.trim();
    case "scroll":
      return `Scrolled ${String(input.scroll_direction ?? "")}`.trim();
    case "scroll_to":
      return `Scrolled to ${where}`.trim();
    case "wait":
      return `Waited ${String(input.duration ?? "")} seconds`;
    case "new_tab":
      return "Opened a new tab";
    case "switch_tab":
      return `Switched to ${String(input.tab_id ?? "")}`;
    case "close_tab":
      return `Closed ${String(input.tab_id ?? "")}`;
    case "list_tabs":
      return "Checked the open tabs";
    default:
      return name.replace(/_/g, " ");
  }
}
