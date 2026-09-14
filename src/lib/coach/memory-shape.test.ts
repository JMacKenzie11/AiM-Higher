import { describe, it, expect } from "vitest";
import {
  parseMemoryResponse,
  applyNeverWrittenFilter,
  filterVerdict,
  selectForContext,
  formatMemoryBlock,
  MAX_MEMORIES_PER_CONVERSATION,
  type StoredMemory,
} from "./memory-shape";

describe("parseMemoryResponse", () => {
  it("reads the documented shape", () => {
    expect(
      parseMemoryResponse(
        '{"memories":[{"kind":"said","content":"Wants to delegate dispatch to Marcus"}]}'
      )
    ).toEqual([{ kind: "said", content: "Wants to delegate dispatch to Marcus" }]);
  });

  it("survives a fence and surrounding prose", () => {
    const raw =
      'Here you go:\n```json\n{"memories":[{"kind":"inferred","content":"Avoids conflict with direct reports"}]}\n```\nHope that helps.';
    expect(parseMemoryResponse(raw)).toEqual([
      { kind: "inferred", content: "Avoids conflict with direct reports" },
    ]);
  });

  it("returns NOTHING rather than a guess when the shape is wrong", () => {
    // A guess here is written down permanently under somebody's name.
    expect(parseMemoryResponse("I couldn't find anything durable.")).toEqual([]);
    expect(parseMemoryResponse('{"memories":"none"}')).toEqual([]);
    expect(parseMemoryResponse("")).toEqual([]);
    expect(parseMemoryResponse('{"items":[{"kind":"said","content":"x"}]}')).toEqual([]);
  });

  it("drops entries with an unknown kind rather than defaulting one", () => {
    // Defaulting to 'said' would put words in someone's mouth;
    // defaulting to 'inferred' would invent a reading nobody had.
    expect(
      parseMemoryResponse(
        '{"memories":[{"kind":"observed","content":"x"},{"kind":"said","content":"y"}]}'
      )
    ).toEqual([{ kind: "said", content: "y" }]);
  });

  it("caps the number kept", () => {
    const many = {
      memories: Array.from({ length: 20 }, (_, i) => ({
        kind: "said",
        content: `memory ${i}`,
      })),
    };
    expect(parseMemoryResponse(JSON.stringify(many))).toHaveLength(
      MAX_MEMORIES_PER_CONVERSATION
    );
  });

  it("treats an empty list as a correct answer", () => {
    expect(parseMemoryResponse('{"memories":[]}')).toEqual([]);
  });
});

describe("the never-written filter", () => {
  it("drops health, in either kind, however it is phrased", () => {
    for (const content of [
      "Was in hospital for two weeks in October",
      "Started therapy in the spring",
      "Is on medication that affects his mornings",
      "Mentioned a cancer diagnosis in the family",
      "Has been off on stress leave",
    ]) {
      expect(filterVerdict(content)).toEqual({ keep: false, reason: "health" });
    }
  });

  it("drops family and personal life", () => {
    for (const content of [
      "Going through a divorce",
      "Her father passed away in March",
      "Struggling with the mortgage since the rate change",
    ]) {
      expect(filterVerdict(content).keep).toBe(false);
    }
  });

  it("KEEPS personnel and hiring thinking, including the difficult kind", () => {
    // The point of the wall is that this can be remembered safely.
    for (const content of [
      "Is considering letting Marcus go before the end of the quarter",
      "Worried that Dana is not ready for the lead role",
      "Planning to restructure dispatch under one manager",
      "Doubts the second ops hire was the right call",
      "Wants to promote Priya but is worried about the optics",
    ]) {
      expect(filterVerdict(content)).toEqual({ keep: true });
    }
  });

  it("keeps ordinary work content", () => {
    for (const content of [
      "Wants to cut travel substantially next quarter",
      "Finds the weekly meeting frustrating and has for months",
      "Leaves hard conversations until Friday",
    ]) {
      expect(filterVerdict(content)).toEqual({ keep: true });
    }
  });

  it("lets an explicit WORK framing rescue a family word", () => {
    // The narrow exception: parental leave as a staffing problem is
    // a work fact; somebody's parental leave is not ours to keep.
    expect(filterVerdict("Needs a plan for maternity cover in dispatch")).toEqual({
      keep: true,
    });
    expect(filterVerdict("Is on maternity from March").keep).toBe(false);
  });

  it("health is absolute and is NOT rescued by a work framing", () => {
    // A staffing word next to a medical fact does not make the
    // medical fact ours.
    expect(
      filterVerdict("Needs cover while Sam is in hospital").keep
    ).toBe(false);
  });

  it("reports what it dropped and why", () => {
    const result = applyNeverWrittenFilter([
      { kind: "said", content: "Wants to delegate dispatch" },
      { kind: "said", content: "Was in hospital in October" },
      { kind: "inferred", content: "Going through a divorce" },
    ]);
    expect(result.kept).toHaveLength(1);
    expect(result.dropped.map((d) => d.reason)).toEqual(["health", "family"]);
  });
});

const NOW = "2026-09-14T12:00:00Z";
const ago = (days: number) =>
  new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

const mem = (id: string, days: number): StoredMemory => ({
  id,
  kind: "said",
  content: `memory ${id}`,
  created_at: ago(days),
});

describe("selectForContext", () => {
  it("prefers recent memories", () => {
    const picked = selectForContext(
      [mem("old", 100), mem("new", 2), mem("mid", 30)],
      NOW
    );
    expect(picked.map((m) => m.id)).toEqual(["new", "mid", "old"]);
  });

  it("drops memories past the window from the DEFAULT block only", () => {
    // Not deleted — memory_lookup still reaches them. The default
    // block is a budget, not the archive.
    const picked = selectForContext([mem("ancient", 400), mem("new", 1)], NOW);
    expect(picked.map((m) => m.id)).toEqual(["new"]);
  });

  it("caps the count", () => {
    const many = Array.from({ length: 30 }, (_, i) => mem(`m${i}`, i));
    expect(selectForContext(many, NOW)).toHaveLength(12);
  });

  it("returns nothing for a person with no memory", () => {
    expect(selectForContext([], NOW)).toEqual([]);
  });
});

describe("formatMemoryBlock", () => {
  it("omits the block entirely when there is nothing to say", () => {
    // An empty <coach_memory> block is a prompt telling the model
    // there is a memory system and it is empty, which invites
    // apologising for it.
    expect(formatMemoryBlock([], NOW)).toBe("");
  });

  it("labels each memory with its kind and its age", () => {
    const block = formatMemoryBlock(
      [
        { id: "a", kind: "said", content: "Wants to delegate dispatch", created_at: ago(3) },
        { id: "b", kind: "inferred", content: "Avoids conflict with reports", created_at: ago(40) },
      ],
      NOW
    );
    expect(block).toContain("[said] Wants to delegate dispatch (3 days ago)");
    expect(block).toContain("[inferred] Avoids conflict with reports (6 weeks ago)");
    // The framing the provenance rules depend on.
    expect(block).toContain("RECALL, not facts");
  });
});


// End-to-end through the shaping layer: what the model returns, what
// survives the filter, what would be written. The model call and the
// database are the action's business; this is the decision it makes
// between them, which is the part that decides what ends up
// permanently attached to a person.
describe("summarization output, end to end through the shaping layer", () => {
  it("separates said from inferred and keeps both", () => {
    const raw = JSON.stringify({
      memories: [
        { kind: "said", content: "Keeps putting off handing dispatch to Marcus" },
        { kind: "inferred", content: "Finds conversations with direct reports harder than peer ones" },
      ],
    });
    const { kept, dropped } = applyNeverWrittenFilter(parseMemoryResponse(raw));
    expect(dropped).toHaveLength(0);
    expect(kept.map((m) => m.kind)).toEqual(["said", "inferred"]);
  });

  it("drops seeded health and family content, keeps the personnel content beside it", () => {
    // The three rules of the never-written filter, in one payload,
    // because they are decided together in practice: a real
    // conversation about a struggling report touches all three.
    const raw = JSON.stringify({
      memories: [
        { kind: "said", content: "Is considering letting Marcus go before the quarter closes" },
        { kind: "said", content: "Marcus has been off on sick leave since August" },
        { kind: "inferred", content: "The delay is partly about his divorce" },
        { kind: "said", content: "Wants Priya to take the dispatch lead if Marcus goes" },
      ],
    });
    const { kept, dropped } = applyNeverWrittenFilter(parseMemoryResponse(raw));

    expect(kept.map((m) => m.content)).toEqual([
      "Is considering letting Marcus go before the quarter closes",
      "Wants Priya to take the dispatch lead if Marcus goes",
    ]);
    expect(dropped.map((d) => d.reason).sort()).toEqual(["family", "health"]);
  });

  it("writes nothing at all from a conversation that turned up nothing", () => {
    // An empty result is a correct answer. Padding it is how a
    // coaching record fills with things nobody said.
    const { kept } = applyNeverWrittenFilter(parseMemoryResponse('{"memories":[]}'));
    expect(kept).toEqual([]);
  });

  it("writes nothing when the model answers in prose", () => {
    const { kept } = applyNeverWrittenFilter(
      parseMemoryResponse("Nothing durable came up in this conversation.")
    );
    expect(kept).toEqual([]);
  });
});
