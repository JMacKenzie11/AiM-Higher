import { describe, it, expect } from "vitest";
import {
  parseMemoryResponse,
  applyNeverWrittenFilter,
  filterVerdict,
  selectForContext,
  formatMemoryBlock,
  MAX_MEMORIES_PER_CONVERSATION,
  type StoredMemory,
  selectSweepCandidates,
  type SweepCandidate,
  CONTEXT_MEMORY_DAYS,
  pinnedCarryLimit,
  declineMessageFor,
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

describe("selectSweepCandidates", () => {
  const pick = (
    candidates: SweepCandidate[],
    turns: Record<string, number>,
    maxPerRun = 3
  ) =>
    selectSweepCandidates({
      candidates,
      userTurns: new Map(Object.entries(turns)),
      maxPerRun,
      minUserTurns: 2,
    }).map((c) => c.id);

  const convo = (id: string, updated: string, wm: string | null = null): SweepCandidate => ({
    id,
    updated_at: updated,
    memory_summarized_through: wm,
  });

  // The production deadlock, as found on 2026-09-14. The three newest
  // conversations were empty shells; the real ones sat behind them and
  // were never reached, because the old code looked at only
  // MAX_PER_RUN + 1 rows and a thin row consumed a slot permanently.
  it("looks past a run of empty conversations at the head of the queue", () => {
    const candidates = [
      convo("empty-1", "2026-09-14T21:50:50Z"),
      convo("empty-2", "2026-09-14T21:09:36Z"),
      convo("one-turn", "2026-09-14T15:23:40Z"),
      convo("empty-3", "2026-08-31T23:56:35Z"),
      convo("real-1", "2026-08-31T23:22:00Z"),
      convo("real-2", "2026-08-31T23:21:00Z"),
    ];
    const turns = {
      "empty-1": 0,
      "empty-2": 0,
      "one-turn": 1,
      "empty-3": 0,
      "real-1": 9,
      "real-2": 10,
    };
    // The old shape, demonstrated rather than asserted about: it
    // fetched only MAX_PER_RUN + 1 rows, so the function never saw
    // anything past the empty ones. This is what production did on
    // every page entry, forever.
    expect(pick(candidates.slice(0, 4), turns)).toEqual([]);

    // Looking at the whole window reaches the real conversations.
    expect(pick(candidates, turns)).toEqual(["real-1", "real-2"]);
  });

  it("still refuses to summarize a thin conversation", () => {
    const candidates = [convo("a", "2026-09-14T10:00:00Z")];
    expect(pick(candidates, { a: 1 })).toEqual([]);
  });

  it("caps model calls at maxPerRun however many it had to look at", () => {
    const candidates = [
      convo("skip-1", "2026-09-14T09:00:00Z"),
      convo("skip-2", "2026-09-14T08:00:00Z"),
      convo("a", "2026-09-14T07:00:00Z"),
      convo("b", "2026-09-14T06:00:00Z"),
      convo("c", "2026-09-14T05:00:00Z"),
      convo("d", "2026-09-14T04:00:00Z"),
    ];
    const turns = { "skip-1": 0, "skip-2": 0, a: 4, b: 4, c: 4, d: 4 };
    expect(pick(candidates, turns)).toEqual(["a", "b", "c"]);
  });

  it("skips a conversation already summarized through its latest message", () => {
    const candidates = [
      convo("done", "2026-09-14T10:00:00Z", "2026-09-14T10:00:00Z"),
      convo("grew", "2026-09-14T11:00:00Z", "2026-09-14T09:00:00Z"),
    ];
    expect(pick(candidates, { done: 5, grew: 5 })).toEqual(["grew"]);
  });

  // A conversation with no messages at all has no timestamp to mark,
  // so it can never be watermarked out of the way. Looking past it is
  // the only thing that works.
  it("never returns an empty conversation, however often it is seen", () => {
    const candidates = [convo("ghost", "2026-09-14T10:00:00Z")];
    expect(pick(candidates, { ghost: 0 })).toEqual([]);
    expect(pick(candidates, {})).toEqual([]);
  });
});

// ---- About mode: what is kept, and what is still refused -------
//
// The frame rule shipped in #144 is GONE, by the product owner's
// decision: a leader's observations and assessments of a team member
// are memory like anything else, and governance of those records is
// the client organisation's responsibility. What survives is the
// never-written list, which was never about who the sentence is
// about. It is about which categories are nobody's to keep.
describe("filterVerdict, about-mode subjects", () => {
  it("KEEPS the leader's observations and assessments of the subject", () => {
    for (const content of [
      "Said Marcus keeps missing the Thursday handoff",
      "Marcus struggles with escalations",
      "Is weighing whether Marcus is in the right role",
      "Doubts whether Marcus is ready for the dispatch run",
      "Marcus missed three deadlines",
    ]) {
      expect(filterVerdict(content)).toEqual({ keep: true });
    }
  });

  it("still refuses health about the SUBJECT, not just the participant", () => {
    for (const content of [
      "Marcus is out for surgery",
      "Marcus has been off since the diagnosis",
    ]) {
      expect(filterVerdict(content)).toEqual({ keep: false, reason: "health" });
    }
  });

  it("still refuses the subject's family and personal life", () => {
    expect(filterVerdict("Marcus is going through a divorce").keep).toBe(false);
  });

  // The narrow work exception is not special-cased for the subject
  // either: it is the same rule, reached the same way.
  it("keeps a work framing that happens to touch the exception list", () => {
    expect(filterVerdict("Planning parental leave cover for Marcus")).toEqual({
      keep: true,
    });
  });
});

// ---- Subject-scoped priority ----------------------------------
//
// The continuity the about-mode feature is for: a leader who coaches
// about several people should still find THIS person's thread when
// they sit down about them, months later, and not have it crowded out
// on recency by five other people's.
describe("selectForContext, subject priority", () => {
  const at = (id: string, daysAgo: number): StoredMemory => ({
    id,
    kind: "said",
    content: `memory ${id}`,
    created_at: new Date(Date.parse("2026-09-15T12:00:00Z") - daysAgo * 86_400_000).toISOString(),
  });
  const NOW = "2026-09-15T12:00:00Z";

  it("places the subject's memories ahead of more recent unrelated ones", () => {
    const rows = [at("other-1", 1), at("other-2", 2), at("subject-1", 40)];
    const picked = selectForContext(rows, NOW, 3, new Set(["subject-1"]));
    expect(picked[0].id).toBe("subject-1");
  });

  it("reorders without widening: the limit still binds", () => {
    const rows = [at("s1", 30), at("s2", 31), at("o1", 1), at("o2", 2)];
    const picked = selectForContext(rows, NOW, 2, new Set(["s1", "s2"]));
    expect(picked.map((p) => p.id)).toEqual(["s1", "s2"]);
    expect(picked).toHaveLength(2);
  });

  // Priority must not smuggle an out-of-window memory into the free
  // block. Old ones stay reachable by memory_lookup, deliberately not
  // free, and that budget rule is not subject to this feature.
  it("does not rescue a memory older than the window", () => {
    const rows = [at("ancient", CONTEXT_MEMORY_DAYS + 10), at("o1", 1)];
    const picked = selectForContext(rows, NOW, 12, new Set(["ancient"]));
    expect(picked.map((p) => p.id)).toEqual(["o1"]);
  });

  it("is a no-op when nothing is prioritised, which is general mode", () => {
    const rows = [at("a", 1), at("b", 2), at("c", 3)];
    expect(selectForContext(rows, NOW, 12).map((p) => p.id)).toEqual(
      selectForContext(rows, NOW, 12, new Set()).map((p) => p.id)
    );
  });
});

// ---- Directed memories: pinned, and what happens at the ceiling --
describe("directed memories in the context block", () => {
  const NOW = "2026-09-15T12:00:00Z";
  const mem = (
    id: string,
    daysAgo: number,
    kind: "said" | "inferred" | "directed"
  ): StoredMemory => ({
    id,
    kind,
    content: `memory ${id}`,
    created_at: new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString(),
  });

  it("carries a directed memory far older than the recency window", () => {
    // The whole point: a person who asked to be remembered something
    // did not ask for four months of it.
    const rows = [
      mem("pinned", CONTEXT_MEMORY_DAYS + 200, "directed"),
      mem("recent", 1, "said"),
    ];
    const picked = selectForContext(rows, NOW, 12);
    expect(picked.map((m) => m.id)).toEqual(["pinned", "recent"]);
  });

  it("puts pinned memories ahead of the recency-weighted slice", () => {
    const rows = [
      mem("s1", 1, "said"),
      mem("s2", 2, "said"),
      mem("p1", 300, "directed"),
    ];
    expect(selectForContext(rows, NOW, 12)[0].id).toBe("p1");
  });

  // THE CEILING. "Always included" and "inside the same budget"
  // cannot both hold without a rule for what gives.
  it("caps pinned memories at their share and drops the OLDEST first", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => mem(`p${i}`, (i + 1) * 10, "directed")),
      mem("said-1", 1, "said"),
    ];
    const picked = selectForContext(rows, NOW, 12);
    const carried = picked.filter((m) => m.kind === "directed").map((m) => m.id);
    expect(carried).toHaveLength(pinnedCarryLimit(12));
    // Newest pinned survive; p11 is the oldest and is not carried.
    expect(carried).toContain("p0");
    expect(carried).not.toContain("p11");
    // And the block is still the budget, not the budget plus pins.
    expect(picked.length).toBeLessThanOrEqual(12);
  });

  it("leaves room for distilled memory even when pins would fill it", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => mem(`p${i}`, i + 1, "directed")),
      mem("said-1", 1, "said"),
    ];
    const picked = selectForContext(rows, NOW, 12);
    expect(picked.some((m) => m.kind !== "directed")).toBe(true);
  });

  it("voices a directed memory as an instruction, not as recall", () => {
    const block = formatMemoryBlock([mem("p1", 400, "directed")], NOW);
    expect(block).toContain("they asked you to remember this");
  });
});

// ---- The decline, for an EXPLICIT ask --------------------------
//
// The never-written list is not softened by the person asking. That
// is a decision, not an oversight: somebody asking Aimee to hold a
// medical fact is asking Aimee to be a place medical facts live, and
// it is not that place. What it owes them is a reason and the
// version it CAN keep.
describe("explicit asks are filtered too", () => {
  it("refuses a health ask and offers the work-framed alternative", () => {
    const ask = "remember my dad is in hospital until October";
    const verdict = filterVerdict(ask);
    expect(verdict).toEqual({ keep: false, reason: "health" });

    // The reply is not a bare refusal. It says what it does not keep,
    // in one sentence, and offers the reduced-capacity reframe.
    const message = declineMessageFor("health");
    expect(message).toMatch(/health or medical/i);
    expect(message).toMatch(/stretched/i);
    expect(message).toMatch(/no reason attached/i);
  });

  it("refuses a family ask and offers the work-framed alternative", () => {
    expect(filterVerdict("remember that my divorce is final in March")).toEqual({
      keep: false,
      reason: "family",
    });
    expect(declineMessageFor("family")).toMatch(/without the personal detail/i);
  });

  it("keeps an ordinary standing instruction", () => {
    expect(
      filterVerdict("remember that I want every plan checked against cash before headcount")
    ).toEqual({ keep: true });
  });
});
