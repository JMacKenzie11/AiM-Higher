import { describe, it, expect } from "vitest";
import { checkUrl, keySequence, rankLines, toModifiers, toPlaywrightChord } from "./browser-keys";

describe("checkUrl", () => {
  it("adds https to an address with no scheme", () => {
    expect(checkUrl("holabirdsports.com")).toEqual({ ok: true, url: "https://holabirdsports.com/" });
  });

  it("keeps http and https", () => {
    expect(checkUrl("http://example.com/a?b=1").ok).toBe(true);
    expect(checkUrl("https://example.com").ok).toBe(true);
  });

  it("refuses every other scheme", () => {
    for (const u of ["file:///etc/passwd", "javascript:alert(1)", "chrome://settings", "data:text/html,hi", "ftp://x.com"]) {
      expect(checkUrl(u).ok, u).toBe(false);
    }
  });

  it("refuses private and loopback addresses", () => {
    for (const u of ["localhost:3000", "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.1", "http://172.20.0.1", "http://169.254.169.254/latest", "http://[::1]/", "http://printer.local"]) {
      expect(checkUrl(u).ok, u).toBe(false);
    }
  });

  it("allows a public address that only looks close to a private one", () => {
    expect(checkUrl("http://172.32.0.1").ok).toBe(true);
    expect(checkUrl("https://10x.example.com").ok).toBe(true);
  });

  it("refuses an empty address", () => {
    expect(checkUrl("  ").ok).toBe(false);
  });
});

describe("keys", () => {
  it("turns people's key names into Playwright's", () => {
    expect(toPlaywrightChord("ctrl+a")).toBe("Control+a");
    expect(toPlaywrightChord("cmd+shift+t")).toBe("Meta+Shift+t");
    expect(toPlaywrightChord("Return")).toBe("Enter");
    expect(toPlaywrightChord("esc")).toBe("Escape");
    expect(toPlaywrightChord("Page_Down")).toBe("PageDown");
    expect(toPlaywrightChord("f5")).toBe("F5");
    expect(toPlaywrightChord("+")).toBe("+");
    expect(toPlaywrightChord("A")).toBe("A");
  });

  it("splits a sequence on spaces", () => {
    expect(keySequence("Backspace Backspace ctrl+v")).toEqual(["Backspace", "Backspace", "Control+v"]);
    expect(keySequence("  ")).toEqual([]);
  });

  it("reads click modifiers", () => {
    expect(toModifiers("ctrl+shift")).toEqual(["Control", "Shift"]);
    expect(toModifiers("cmd")).toEqual(["Meta"]);
    expect(toModifiers(undefined)).toEqual([]);
    expect(toModifiers("banana")).toEqual([]);
  });
});

describe("rankLines", () => {
  const lines = ['  link "Home" [ref_1]', '  textbox "Search..." [ref_2]', '  button "Search" [ref_3]', '  link "Running shoes" [ref_4]'];

  it("puts the lines matching most words first", () => {
    expect(rankLines(lines, "search field textbox")[0]).toBe('textbox "Search..." [ref_2]');
  });

  it("returns nothing for no match", () => {
    expect(rankLines(lines, "checkout")).toEqual([]);
  });

  it("returns at most the limit", () => {
    expect(rankLines(lines, "link", 1)).toHaveLength(1);
  });
});
