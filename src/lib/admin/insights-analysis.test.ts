import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { analyzeConversation } from "./insights-analysis";
import { anonymiser, type Anonymiser } from "@/lib/aimee/anonymise";

const anon = anonymiser({ people: ["Marcus Bell"], companies: ["Benson Seafood"] });
// The check switched off: what the job stored before decision 1.
const noCheck: Anonymiser = { scrub: (t) => t, faults: () => [] };

const reply = (o: object) => ({ content: [{ type: "text", text: JSON.stringify(o) }] }) as unknown as Anthropic.Message;
const NAMED = {
  summary: "The leader is weighing whether Marcus is ready to return after his surgery.",
  topics: ["role fit", "Marcus"],
  friction_level: 2,
  friction_signal: "the CEO keeps overruling",
  opportunity: null,
};
const CLEAN = {
  summary: "The leader is preparing a conversation with a report about role fit.",
  topics: ["role fit"],
  friction_level: 2,
  friction_signal: "decisions overruled",
  opportunity: null,
};
const client = (...answers: object[]) => {
  const create = vi.fn();
  for (const a of answers) create.mockResolvedValueOnce(reply(a));
  return { client: { messages: { create } } as unknown as Anthropic, create };
};

describe("analyzeConversation, anonymously", () => {
  it("control: without the check, a summary naming someone is stored as written", async () => {
    const { client: c } = client(NAMED);
    const r = await analyzeConversation(c, "m", "transcript", noCheck);
    expect(r.payload.summary).toContain("Marcus");
  });

  it("sends a named answer back once, naming the fault, and stores the anonymous rewrite", async () => {
    const { client: c, create } = client(NAMED, CLEAN);
    const r = await analyzeConversation(c, "m", "transcript", anon);
    expect(create).toHaveBeenCalledTimes(2);
    const retryAsk = create.mock.calls[1][0].messages.at(-1).content as string;
    expect(retryAsk).toContain("a name");
    expect(retryAsk).not.toContain("Marcus");
    expect(r).toEqual({ payload: CLEAN, retried: true, dropped: [] });
  });

  it("drops what still breaks the rule after the retry, and keeps what passes", async () => {
    const { client: c } = client(NAMED, NAMED);
    const r = await analyzeConversation(c, "m", "transcript", anon);
    expect(r.payload).toEqual({
      summary: "",
      topics: ["role fit"],
      friction_level: 2,
      friction_signal: null,
      opportunity: null,
    });
    expect(r.dropped).toEqual(["a name", "a personal detail", "a role that identifies one person"]);
  });

  it("does not ask twice for an answer that is already anonymous", async () => {
    const { client: c, create } = client(CLEAN);
    expect((await analyzeConversation(c, "m", "transcript", anon)).retried).toBe(false);
    expect(create).toHaveBeenCalledOnce();
  });
});
