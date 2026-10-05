import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOfferWhen, normalizeOfferWhen, readOfferWhen, OFFER_WHEN_MAX } from "./offer-when";

// agents.offer_when (0262) is read apart from every other agent column
// so that a failure costs Aimee the offers and nothing else. These hold
// the three things that makes true: an error reads as "no sentences",
// a fleet push can tell "none" from "could not read", and the Hub's
// box refuses in words what the constraint would refuse in an error.

// A query builder that answers every chain with one result.
function fakeDb(result: { data: unknown; error: unknown } | "throw"): SupabaseClient {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "not", "in", "eq"]) builder[m] = () => builder;
  builder.maybeSingle = async () => {
    if (result === "throw") throw new Error("network");
    return result;
  };
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    result === "throw" ? Promise.reject(new Error("network")).catch(reject) : Promise.resolve(result).then(resolve);
  return { from: () => builder } as unknown as SupabaseClient;
}

describe("loadOfferWhen", () => {
  it("maps each agent to its trimmed sentence", async () => {
    const db = fakeDb({
      data: [
        { id: "a1", offer_when: "  Someone needs to raise a problem.  " },
        { id: "a2", offer_when: "   " },
      ],
      error: null,
    });
    const out = await loadOfferWhen(db);
    expect(out.get("a1")).toBe("Someone needs to raise a problem.");
    expect(out.has("a2")).toBe(false);
  });

  it("reads an error, including a missing column, as no sentences", async () => {
    const db = fakeDb({ data: null, error: { code: "42703", message: 'column "offer_when" does not exist' } });
    expect((await loadOfferWhen(db)).size).toBe(0);
  });

  it("reads a thrown error as no sentences", async () => {
    expect((await loadOfferWhen(fakeDb("throw"))).size).toBe(0);
  });
});

describe("readOfferWhen", () => {
  it("returns the sentence", async () => {
    expect(await readOfferWhen(fakeDb({ data: { offer_when: "When stuck." }, error: null }), "a1")).toBe("When stuck.");
  });

  it("returns null for an agent with no sentence, which clears the target's", async () => {
    expect(await readOfferWhen(fakeDb({ data: { offer_when: null }, error: null }), "a1")).toBeNull();
  });

  it("returns undefined when it could not read, which leaves the target's alone", async () => {
    expect(await readOfferWhen(fakeDb({ data: null, error: { message: "boom" } }), "a1")).toBeUndefined();
    expect(await readOfferWhen(fakeDb("throw"), "a1")).toBeUndefined();
  });
});

describe("normalizeOfferWhen", () => {
  it("trims, and treats empty as never offered", () => {
    expect(normalizeOfferWhen("  When stuck.  ")).toEqual({ ok: true, value: "When stuck." });
    expect(normalizeOfferWhen("   ")).toEqual({ ok: true, value: null });
  });

  it("refuses a sentence over the limit, in words", () => {
    const r = normalizeOfferWhen("x".repeat(OFFER_WHEN_MAX + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(String(OFFER_WHEN_MAX));
  });

  it("holds the same limit as the migration's constraint", async () => {
    const fs = await import("node:fs/promises");
    const sql = await fs.readFile("supabase/migrations/0262_session_offers.sql", "utf8");
    expect(sql).toContain(`char_length(offer_when) between 1 and ${OFFER_WHEN_MAX}`);
  });
});
