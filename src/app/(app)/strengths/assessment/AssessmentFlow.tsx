"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import ProgressBar from "@/components/strengths/ProgressBar";
import { LIKERT_LABELS, type Item } from "@/lib/strengths/types";

type Response = { item_id: string; value: number };
type NarrativeMsg = { role: "assistant" | "user"; content: string };

type Phase = "cards" | "narrative" | "finishing";

export default function AssessmentFlow({
  assessmentId,
  items,
  existingResponses,
  existingNarrative,
  firstName,
}: {
  assessmentId: string;
  items: Item[];
  existingResponses: Response[];
  existingNarrative: NarrativeMsg[];
  firstName: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const cardItems = useMemo(
    () => [...items].sort((a, b) => a.sort_order - b.sort_order),
    [items],
  );

  const [responses, setResponses] = useState<Record<string, number>>(
    Object.fromEntries(existingResponses.map((r) => [r.item_id, r.value])),
  );

  const firstUnanswered = cardItems.findIndex((i) => responses[i.id] === undefined);
  const [index, setIndex] = useState<number>(
    firstUnanswered === -1 ? cardItems.length : firstUnanswered,
  );

  const [phase, setPhase] = useState<Phase>(
    firstUnanswered === -1 ? "narrative" : "cards",
  );

  // Randomized side flip for orientation items — stable per user via a stored map
  const [sideFlip] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const it of cardItems) {
      if (it.item_type === "orientation") {
        map[it.id] = Math.random() < 0.5;
      }
    }
    return map;
  });

  // Narrative
  const [narrative, setNarrative] = useState<NarrativeMsg[]>(existingNarrative);
  const [narrativeInput, setNarrativeInput] = useState("");
  const [narrativeSending, setNarrativeSending] = useState(false);
  const [narrativeDone, setNarrativeDone] = useState(false);

  useEffect(() => {
    if (phase !== "narrative") return;
    if (narrative.length === 0) {
      // Open with the verbatim prompt
      const opener =
        "Think of a time at work when you were at your best, a moment you'd point to and say that's when I was really in my element. What was happening, what were you doing, and what made it feel that way?";
      setNarrative([{ role: "assistant", content: opener }]);
      supabase
        .from("strengths_narrative_messages")
        .insert({
          assessment_id: assessmentId,
          role: "assistant",
          content: opener,
        })
        .then(() => {});
    }
  }, [phase, narrative.length, assessmentId, supabase]);

  const total = cardItems.length;
  const answered = Object.keys(responses).length;

  async function saveResponse(itemId: string, value: number) {
    setResponses((r) => ({ ...r, [itemId]: value }));
    await supabase.from("strengths_responses").upsert(
      { assessment_id: assessmentId, item_id: itemId, value },
      { onConflict: "assessment_id,item_id" },
    );
  }

  async function selectLikert(item: Item, value: number) {
    await saveResponse(item.id, value);
    setTimeout(() => {
      if (index + 1 >= cardItems.length) {
        setPhase("narrative");
      } else {
        setIndex(index + 1);
      }
    }, 800);
  }

  async function selectOrientation(item: Item, normalized: number) {
    await saveResponse(item.id, normalized);
    setTimeout(() => {
      if (index + 1 >= cardItems.length) {
        setPhase("narrative");
      } else {
        setIndex(index + 1);
      }
    }, 800);
  }

  function back() {
    if (index === 0) return;
    setIndex(index - 1);
  }

  // Furthest index the user is allowed to move forward to without answering:
  //  - if every card has an answer, it's the last card index (they can
  //    still leaf back through, and hitting Next on the last card advances
  //    to the narrative phase);
  //  - otherwise it's the first unanswered card index.
  const firstUnansweredNow = cardItems.findIndex(
    (i) => responses[i.id] === undefined,
  );
  const maxAllowedIndex =
    firstUnansweredNow === -1 ? cardItems.length - 1 : firstUnansweredNow;

  function forward() {
    if (index >= maxAllowedIndex) {
      // On the last card with every card answered: continue to narrative.
      if (
        index === cardItems.length - 1 &&
        firstUnansweredNow === -1
      ) {
        setPhase("narrative");
      }
      return;
    }
    setIndex(index + 1);
  }

  async function sendNarrative() {
    if (!narrativeInput.trim() || narrativeSending) return;
    const userMsg: NarrativeMsg = { role: "user", content: narrativeInput.trim() };
    const nextLog = [...narrative, userMsg];
    setNarrative(nextLog);
    setNarrativeInput("");
    setNarrativeSending(true);

    await supabase.from("strengths_narrative_messages").insert({
      assessment_id: assessmentId,
      role: "user",
      content: userMsg.content,
    });

    const assistantTurns = nextLog.filter((m) => m.role === "assistant").length;
    if (assistantTurns >= 3) {
      setNarrativeDone(true);
      setNarrativeSending(false);
      return;
    }

    try {
      const res = await fetch("/api/strengths/narrative", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assessment_id: assessmentId,
          messages: nextLog,
        }),
      });
      const data = await res.json();
      if (data.done) {
        setNarrativeDone(true);
      } else if (data.reply) {
        setNarrative([
          ...nextLog,
          { role: "assistant", content: data.reply },
        ]);
      }
    } catch {
      // If the API fails, close politely and let the results generation proceed.
      setNarrativeDone(true);
    }
    setNarrativeSending(false);
  }

  async function finish(skipped: boolean) {
    setPhase("finishing");
    if (skipped && narrative.length <= 1) {
      // record a marker so results generation knows it was skipped
      await supabase.from("strengths_narrative_messages").insert({
        assessment_id: assessmentId,
        role: "user",
        content: "[skipped]",
      });
    }
    await supabase
      .from("strengths_assessments")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", assessmentId);

    try {
      await fetch("/api/strengths/generate-results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessment_id: assessmentId }),
      });
    } catch {
      // Results page will retry generation if missing.
    }
    router.push("/results");
  }

  if (phase === "finishing") {
    return (
      <div className="assessment-shell">
        <div className="empty-state">
          <div className="stack-3">
            <div className="subhead">Generating your results</div>
            <p className="muted" style={{ margin: 0 }}>
              Give us a moment. This takes a few seconds.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "narrative") {
    return (
      <div className="assessment-shell">
        <div className="stack-5">
          <ProgressBar current={total} total={total} />
          <div className="card stack-4">
            <div className="subhead">A couple of questions in your own words</div>
            <div className="chat-log" role="log">
              {narrative.map((m, i) => (
                <div key={i} className={`chat-msg ${m.role}`}>
                  <div className="chat-bubble">{m.content}</div>
                </div>
              ))}
              {narrativeSending && (
                <div className="chat-msg assistant">
                  <div className="chat-bubble faint">Thinking...</div>
                </div>
              )}
            </div>
            {!narrativeDone && (
              <div className="chat-input-row">
                <textarea
                  className="textarea"
                  placeholder="Type your answer..."
                  value={narrativeInput}
                  onChange={(e) => setNarrativeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      sendNarrative();
                    }
                  }}
                  disabled={narrativeSending}
                />
                <button
                  className="btn btn-primary"
                  onClick={sendNarrative}
                  disabled={!narrativeInput.trim() || narrativeSending}
                >
                  Send
                </button>
              </div>
            )}
            <div className="spread">
              <button
                className="btn btn-ghost sm"
                onClick={() => finish(true)}
              >
                Skip this step
              </button>
              {narrativeDone && (
                <button
                  className="btn btn-primary"
                  onClick={() => finish(false)}
                >
                  Finish
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const item = cardItems[index];
  if (!item) return null;

  return (
    <div className="assessment-shell">
      <div className="stack-5">
        <ProgressBar current={index + 1} total={total} />
        <div className="assessment-card stack-5 card-fade-enter" key={item.id}>
          {item.item_type === "orientation" ? (
            <OrientationCard
              item={item}
              flipped={sideFlip[item.id] ?? false}
              currentValue={responses[item.id]}
              onSelect={(normalized) => selectOrientation(item, normalized)}
            />
          ) : (
            <LikertCard
              item={item}
              currentValue={responses[item.id]}
              onSelect={(v) => selectLikert(item, v)}
            />
          )}
          <div className="spread">
            <button
              className="btn btn-ghost sm"
              onClick={back}
              disabled={index === 0}
            >
              Back
            </button>
            <div className="caption">{answered} answered</div>
            <button
              className="btn btn-ghost sm"
              onClick={forward}
              disabled={
                index >= maxAllowedIndex &&
                !(
                  index === cardItems.length - 1 &&
                  firstUnansweredNow === -1
                )
              }
            >
              Next
            </button>
          </div>
        </div>
        <p className="caption center" style={{ textAlign: "center" }}>
          Hi {firstName}, step back to change an answer, or step forward
          through anything you've already answered.
        </p>
      </div>
    </div>
  );
}

function LikertCard({
  item,
  currentValue,
  onSelect,
}: {
  item: Item;
  currentValue: number | undefined;
  onSelect: (value: number) => void;
}) {
  return (
    <div className="stack-5">
      <div className="stack-2">
        <div className="subhead">Rate this statement</div>
        <p className="assessment-statement">{item.text}</p>
      </div>
      <div className="likert-list">
        {LIKERT_LABELS.map((label, i) => {
          const value = i + 1;
          return (
            <button
              key={value}
              className={`likert-option ${currentValue === value ? "selected" : ""}`}
              onClick={() => onSelect(value)}
            >
              <span className="radio-dot" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OrientationCard({
  item,
  flipped,
  currentValue,
  onSelect,
}: {
  item: Item;
  flipped: boolean;
  currentValue: number | undefined;
  onSelect: (normalized: number) => void;
}) {
  // Stored value convention (normalized): 1 = strongly direct, 4 = strongly facilitative.
  // Seed convention: item.text is always the direct option, item.text_b the facilitative.
  // `flipped` decides which renders as on-screen A (left/top) vs B (right/bottom).
  const directText = item.text;
  const facilitativeText = item.text_b ?? "";

  const aText = flipped ? facilitativeText : directText;
  const bText = flipped ? directText : facilitativeText;
  const aIsDirect = !flipped;

  // Intensity buttons labeled by the on-screen A/B, mapped back to the direct scale.
  const intensities: { label: string; normalized: number }[] = [
    { label: "Strongly A", normalized: aIsDirect ? 1 : 4 },
    { label: "Lean A", normalized: aIsDirect ? 2 : 3 },
    { label: "Lean B", normalized: aIsDirect ? 3 : 2 },
    { label: "Strongly B", normalized: aIsDirect ? 4 : 1 },
  ];

  return (
    <div className="stack-5">
      <div className="subhead">Which is closer to you?</div>
      <div className="orientation-options">
        <div className="orientation-choice stack-2">
          <div className="subhead subhead-navy">A</div>
          <div>{aText}</div>
        </div>
        <div className="orientation-choice stack-2">
          <div className="subhead subhead-navy">B</div>
          <div>{bText}</div>
        </div>
      </div>
      <div className="orientation-intensity" role="radiogroup">
        {intensities.map((opt) => (
          <button
            key={opt.label}
            className={currentValue === opt.normalized ? "selected" : ""}
            onClick={() => onSelect(opt.normalized)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
