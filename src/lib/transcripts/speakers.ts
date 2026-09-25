import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

// WHO WAS SPEAKING — resolved once, before anything else runs.
//
// ---- THE PROBLEM THIS EXISTS FOR -------------------------------
//
// Otter labels people "Speaker 1" through "Speaker 13". Every
// section of the summary used to work that out for itself, so the
// commitments call, the narrative and the facilitation review each
// guessed independently and disagreed. A commitment whose text named
// Ashley came out Unassigned; an attendee list invented a person who
// was not in the room.
//
// One mapping, made first, used by everything after it. No section
// re-guesses.
//
// ---- UNCERTAINTY IS A RESULT, NOT A FAILURE --------------------
//
// Diarization is imperfect in ways that matter here. One label can
// cover more than one person — when Casey asks Pinky to share, the
// reply comes back under the label already assigned to someone else
// — and minor labels are often fragments: a cough, a crosstalk word,
// someone saying "yeah".
//
// So the mapping carries a confidence per label and is allowed to
// answer "unknown". A forced match is worse than an honest gap,
// because everything downstream trusts this.
//
// ---- NEVER INVENT A NAME ---------------------------------------
//
// A name may come from the roster or from the transcript, and from
// nowhere else. The schema says so and the prompt says so, because
// the failure mode is a plausible-sounding person who was never
// there, and a reader has no way to catch that.

export type SpeakerConfidence = "high" | "medium" | "low" | "unknown";

export type SpeakerMapping = {
  label: string;
  // What in the transcript points at this person. Written BEFORE the
  // name, so the name is a conclusion rather than a first guess —
  // the same ordering rule the facilitation schema learned the hard
  // way.
  evidence: string;
  name: string | null;
  confidence: SpeakerConfidence;
  // Set when the label plainly covers more than one voice, so later
  // sections can hedge rather than attribute everything to one
  // person.
  shared_label?: boolean;
};

export type SpeakerMap = {
  speakers: SpeakerMapping[];
};

const TOOL: Anthropic.Tool = {
  name: "record_speaker_map",
  description:
    "Record who each transcript speaker label refers to. One entry per label that appears in the transcript.",
  input_schema: {
    type: "object",
    required: ["speakers"],
    properties: {
      speakers: {
        type: "array",
        items: {
          type: "object",
          // evidence first: the name is a conclusion drawn from it.
          required: ["label", "evidence", "name", "confidence"],
          properties: {
            label: {
              type: "string",
              description: "The label exactly as the transcript writes it, e.g. 'Speaker 3'.",
            },
            evidence: {
              type: "string",
              description:
                "What in the transcript points at this person — a topic only they would own, someone addressing them by name, a role they describe. One or two sentences. Write this BEFORE deciding the name.",
            },
            name: {
              type: ["string", "null"],
              description:
                "The person's name, taken ONLY from the roster or from the transcript itself. Null when the evidence does not identify anybody — that is a valid and useful answer. NEVER invent a plausible name.",
            },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low", "unknown"],
              description:
                "high = addressed by name or owns a topic nobody else could. medium = strong role match. low = a guess worth recording. unknown = no idea, and `name` must be null.",
            },
            shared_label: {
              type: "boolean",
              description:
                "True when this label plainly covers more than one voice — diarization merges people. Later sections will hedge attribution for it.",
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You map speaker labels in a meeting transcript to real people.

THE CANDIDATE SET IS THE COMPANY'S PEOPLE LIST, GIVEN TO YOU ABOVE.

Work down that list and ask, for each person: is anybody in this
transcript them? A label is far easier to place when you start from
who could be at the meeting than when you start from the label and
search for anyone who fits. Somebody whose role is Office Manager
talking about the website, the printer and a savings plan is that
Office Manager; reading the same turn cold, they are "a speaker who
mentions several administrative things".

Company terms come from the same list, plus the functional chart and
the One-Page Plan you were given. When the transcript's spelling of a
place, a supplier or a person is close to one of those, use THEIRS —
a recording that says "Elm and Dale" for a place the company calls
Elmendale is a transcription error, not a second place. Only
correct toward a name the company actually holds; never toward one
that merely sounds similar.

This runs before any summarising. Everything downstream — who owns a commitment, who gets credit for an idea, who attended — uses your answer and does not re-examine it. A wrong mapping becomes a wrong commitment owner on somebody's list.

HOW TO WORK
- Read for topics only one person would own: whoever discusses ROEs and LMIA paperwork, whoever runs sanitation, whoever is calling in remotely.
- Read for direct address. "Pinky, do you want to share?" identifies the NEXT speaker, not the one talking.
- Read for self-identification and for someone being thanked by name.

WHAT YOU MUST NOT DO
- Never invent a name. Names come from the roster or from the transcript. If neither offers one, set name to null and confidence to "unknown". An honest gap is useful; a plausible invention is not, because nobody reading the summary can catch it.
- Do not force a match to fill the list. Minor labels are often fragments — a cough, crosstalk, one word of agreement. "unknown" is the right answer for those.
- Do not assume one label is one person. Diarization merges voices. When a label's evidence points at two different people, set shared_label true and name the one it mostly is.

Write the evidence before the name. If you cannot write evidence, you do not have a mapping.`;

// THE MODEL PICKS THE SHAPE, NOT US.
//
// The schema asks for `speakers` as an array. What came back on a
// real run was an OBJECT keyed by label —
// {"Speaker 1": {...}, "Speaker 2": {...}} — with stop_reason
// "tool_use", so the call was complete and the model simply chose
// the other reasonable encoding of the same information.
//
// Rejecting that meant the map returned null, every later section
// went back to guessing, and the only symptom was commitments
// coming out unassigned. Accept both, because the cost of being
// strict here is silent and the cost of being lenient is nothing.
function normalise(input: unknown): SpeakerMap | null {
  let raw = (input as { speakers?: unknown } | null)?.speakers;

  // A STRING of JSON, and sometimes wrapping the same key again:
  //   {"speakers": "{\"speakers\": [ ... ]}"}
  // Observed on a real run with stop_reason "tool_use", so the call
  // was complete and correct by the model's lights. Unwrap until
  // there is something structural underneath, twice at most — a
  // deeper nest is a different bug and should be reported, not
  // chased.
  for (let depth = 0; typeof raw === "string" && depth < 2; depth++) {
    try {
      const inner: unknown = JSON.parse(raw);
      raw =
        inner && typeof inner === "object" && "speakers" in inner
          ? (inner as { speakers: unknown }).speakers
          : inner;
    } catch {
      return null;
    }
  }

  if (Array.isArray(raw)) return { speakers: raw as SpeakerMapping[] };
  if (raw && typeof raw === "object") {
    const speakers = Object.entries(raw as Record<string, unknown>).map(
      ([label, value]) => ({
        label,
        ...(value as object),
      })
    ) as SpeakerMapping[];
    // A keyed object still has to carry the fields we need.
    return speakers.every((s) => typeof s.label === "string")
      ? { speakers }
      : null;
  }
  return null;
}

export async function mapSpeakers(
  client: Anthropic,
  input: {
    model: string;
    transcript: string;
    // The roster block already assembled for the other calls, plus
    // any company glossary, so spellings resolve here rather than
    // three times downstream.
    companyContextBlock: string;
  }
): Promise<SpeakerMap | null> {
  try {
    const response = await client.messages.create({
      model: input.model,
      // Summarising and matching, not reasoning. Thinking here
      // consumed the whole budget and emitted nothing on the
      // analysis call; see the note in analyze.ts.
      thinking: { type: "disabled" },
      // 13 speaker labels each with a sentence of evidence does not
      // fit in 3000: the tool call was cut off mid-JSON and arrived
      // with no complete tool_use block, so the mapping silently
      // returned null and every section went back to guessing.
      max_tokens: 8000,
      system: [{ type: "text", text: SYSTEM }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_speaker_map" },
      messages: [
        {
          role: "user",
          content: `${input.companyContextBlock}\n\n<transcript>\n${input.transcript}\n</transcript>`,
        },
      ],
    });
    const block = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!block) {
      // Say WHY. A null here sends every later section back to
      // guessing, and "no speaker map" on its own does not tell
      // anybody whether the budget was short or the model refused.
      console.error(
        `[speakers] no tool_use block — stop_reason=${response.stop_reason}, ` +
          `blocks=[${response.content.map((b) => b.type).join(", ")}]`
      );
      return null;
    }
    const parsed = normalise(block.input);
    if (!parsed) {
      console.error(
        `[speakers] could not read the mapping — ` +
          `stop_reason=${response.stop_reason}. RAW: ` +
          JSON.stringify(block.input).slice(0, 1200)
      );
      return null;
    }
    console.log(
      `[speakers] mapped ${parsed.speakers.length} labels ` +
        `(${parsed.speakers.filter((x) => x.name).length} named)`
    );
    return parsed;
  } catch (err) {
    // Best effort. A failed mapping means the summary falls back to
    // what it did before — every section guessing for itself — which
    // is worse but not broken.
    console.error(
      "[speakers] mapping failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// The block handed to every later call. One paragraph per label so
// the model reads it as settled fact rather than as data to re-weigh.
export function formatSpeakerMap(map: SpeakerMap | null): string {
  if (!map || map.speakers.length === 0) return "";
  const lines: string[] = [
    "<speaker_map>",
    "Who each transcript label refers to. This was resolved before",
    "this step and is NOT to be re-examined. Use these names.",
    "",
  ];
  for (const s of map.speakers) {
    if (s.name && (s.confidence === "high" || s.confidence === "medium")) {
      const shared = s.shared_label
        ? " — this label covers more than one voice, so attribute with care"
        : "";
      lines.push(`- ${s.label} = ${s.name} (${s.confidence})${shared}`);
    } else {
      // LOW CONFIDENCE IS UNIDENTIFIED. It used to be passed on as
      // "likely <name>, unconfirmed", and the hedge was worse than the
      // gap: a Benson summary put five of Casey's commitments on
      // "Likely Colby Benson, please confirm", and listed "Likely
      // Shawn Warman" as an attendee. A reader acts on the name and
      // skims past the "likely". A low guess is still a guess.
      lines.push(`- ${s.label} = unidentified. Do not guess a name for them.`);
    }
  }
  lines.push("</speaker_map>");
  return lines.join("\n");
}

// Who the map placed with confidence. Low and unknown are left out
// for the same reason formatSpeakerMap leaves them out.
export function identifiedSpeakers(map: SpeakerMap | null): string[] {
  if (!map) return [];
  return [
    ...new Set(
      map.speakers
        .filter(
          (s) => s.name && (s.confidence === "high" || s.confidence === "medium")
        )
        .map((s) => s.name as string)
    ),
  ];
}

// "SPEAKER 5" NEVER REACHES A READER.
//
// The prompts say so, and a Benson summary still wrote "Speaker 5
// (likely Shawn Warman) confirmed the plan" and "Sherri Alderman
// (referred to by Speaker 4)". A label is a transcript artefact: to
// the people who were in the meeting it reads as proof the summary
// does not know who they are.
//
// Unlike a banned word this can be fixed safely from outside, because
// the right replacement is known. A label the map placed with
// confidence becomes that person's name. Any other becomes "an
// unidentified speaker", which is what the prompt asks for anyway.
// A "(likely X)" hedge attached to a label goes with it, since the
// map did not stand behind that name.
export function replaceSpeakerLabels(
  text: string,
  map: SpeakerMap | null
): { text: string; replaced: number } {
  const named = new Map<string, string>();
  for (const s of map?.speakers ?? []) {
    if (s.name && (s.confidence === "high" || s.confidence === "medium")) {
      named.set(s.label.toLowerCase(), s.name);
    }
  }
  let replaced = 0;
  // A label glossed with another label, "Speaker 7 (Speaker 7)",
  // came out as "An unidentified speaker (an unidentified speaker)".
  // The parenthesis adds nothing, so it goes before anything else.
  text = text.replace(/(\bSpeaker\s+\d+)\s*\(\s*Speaker\s+\d+\s*\)/gi, "$1");
  // Plural first: "Five unidentified speakers (Speakers 5, 7, 8)".
  // A parenthesis holding nothing but labels says nothing to a reader
  // and goes; a list of labels anywhere else becomes one phrase.
  const plural = /\bSpeakers\s+\d+(?:\s*(?:,|and|&)\s*\d+)*/gi;
  text = text
    .replace(/\s*\(\s*Speakers\s+\d+(?:\s*(?:,|and|&)\s*\d+)*\s*\)/gi, () => {
      replaced++;
      return "";
    })
    .replace(plural, () => {
      replaced++;
      return "unidentified speakers";
    });
  const out = text.replace(
    /\bSpeaker\s+(\d+)(?:\s*\((?:likely|possibly|probably)[^)]*\))?/gi,
    (_whole, n: string, offset: number, all: string) => {
      replaced++;
      const name = named.get(`speaker ${n}`);
      if (name) return name;
      // Capitalised at the start of a sentence, a line or a list item.
      const before = all.slice(0, offset);
      const opensSentence =
        before.trim().length === 0 || /(?:[.!?]\s+|(?:^|\n)\s*(?:[-*]\s+)?|\*\*\s*|:\s+)$/.test(before);
      return opensSentence ? "An unidentified speaker" : "an unidentified speaker";
    }
  );
  return { text: out, replaced };
}
