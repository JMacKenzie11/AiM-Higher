import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TITLE_SYSTEM } from "./title";

// Jason, 2026-11-13: "Responding to Busy Excuses from Dalton" titled a
// chat that never named Dalton. The name came from Aimee's notes on
// earlier conversations, which ride in the first message's context.
describe("conversation titles", () => {
  it("use only names the participant used", () => {
    expect(TITLE_SYSTEM).toMatch(/Use a person's name only if the participant used it/);
  });

  it("are written from the exchange without the context prefix", () => {
    const route = readFileSync("src/app/api/coach/route.ts", "utf8");
    const call = route.slice(route.indexOf("void generateTitleForConversation({"));
    expect(call.slice(0, 600)).toContain('messages: buildMessages(history, ""),');
  });

  // The label lands after the reply has finished. A client made then
  // reads cookies outside the request, Next refuses, and the silent
  // catch left 7 of 10 recent production conversations on their date
  // title. It must save through the request's own client.
  it("are saved through the request's client, never one made afterwards", () => {
    const route = readFileSync("src/app/api/coach/route.ts", "utf8");
    const fn = route.slice(route.indexOf("async function generateTitleForConversation("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).not.toMatch(/await createSupabaseServerClient\(/);
    expect(body).toContain("args.supabase");
  });
});
