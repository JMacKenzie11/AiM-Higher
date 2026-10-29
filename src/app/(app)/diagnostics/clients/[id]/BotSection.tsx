"use client";

import { useState } from "react";
import type { BotInput } from "@/lib/diagnostics/actions";
import { botStatusLabel, type BotStatus } from "@/lib/diagnostics/bots";
import type { BotView } from "@/lib/diagnostics/service";
import { shortDate } from "../../format";
import admin from "../../../admin/companies/admin.module.css";
import styles from "../../diagnostics.module.css";

// The bot behind one automation (0308), inside the automation's drawer:
// its code, how it starts, and the agreed savings. Saved with the
// automation. Its last runs, with why any failed, are below.

// The Grok Bot setup box: the bot code and instructions to paste into
// the Grok Bot. Built and kept, switched off (Jason, 2026-10-29: "I
// don't need the grokbot set up section but just build it and hide
// it"). True shows it.
export const GROK_SETUP_SHOWN = false;

const STATUS_TONE: Record<BotStatus, string> = {
  running_well: "",
  late: styles.chipWarn,
  needs_attention: styles.chipWarn,
  stopped: styles.chipBad,
  not_live: styles.chipMuted,
};

export function BotChip({ status }: { status: BotStatus }) {
  return <span className={`${styles.chip} ${STATUS_TONE[status]}`}>{botStatusLabel(status)}</span>;
}

export function seedBot(view: BotView | null, suggestedCode: string, country: string | null): BotInput {
  const b = view?.bot;
  return {
    code: b?.code ?? suggestedCode,
    kind: b?.kind ?? "scheduled",
    every: b?.every ?? "weekday",
    every_hours: b?.every_hours ?? "",
    at_time: b?.at_time ?? "07:00",
    trigger_text: b?.trigger_text ?? "",
    safety_every: b?.safety_every ?? "",
    item_noun: b?.item_noun ?? "item",
    minutes_per_item: b?.minutes_per_item ?? "",
    hourly_rate: b?.hourly_rate ?? "",
    currency: b?.currency ?? (country === "US" ? "USD" : "CAD"),
    agreed_on: b?.agreed_on ?? "",
  };
}

export function setupText(code: string, noun: string): string {
  return [
    "When you finish each run, report it to AiMS HQ with the record_bot_run tool:",
    `  bot: ${code}`,
    "  result: worked or failed",
    `  items: the number of ${noun === "item" ? "items" : `${noun}s`} you handled`,
    '  note: if it failed, one line on why (for example, "the CRM did not respond")',
    "Report a failed run too. Never skip the report.",
  ].join("\n");
}

export function BotSection({
  form,
  setForm,
  view,
}: {
  form: BotInput;
  setForm: (f: (x: BotInput) => BotInput) => void;
  view: BotView | null;
}) {
  const [copied, setCopied] = useState(false);
  const set = (k: keyof BotInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const field = (k: keyof BotInput, label: string, props: Record<string, unknown> = {}) => (
    <div className={admin.field}>
      <label className={admin.label} htmlFor={`bot-${k}`}>
        {label}
      </label>
      <input id={`bot-${k}`} className={admin.input} value={String(form[k] ?? "")} onChange={set(k)} {...props} />
    </div>
  );
  const scheduled = form.kind === "scheduled";

  return (
    <div className={styles.botSection}>
      <h3 className={styles.subhead}>
        The bot
        {view ? <BotChip status={view.health.status} /> : null}
      </h3>
      <div className={styles.body}>
        {field("code", "Bot code", { maxLength: 60, spellCheck: false, autoCapitalize: "off" })}
        <fieldset className={styles.choice}>
          <legend className={admin.label}>How it starts</legend>
          <button type="button" aria-pressed={scheduled} className={`${styles.secondary} ${styles.small}`} onClick={() => setForm((f) => ({ ...f, kind: "scheduled" }))}>
            On a schedule
          </button>
          <button type="button" aria-pressed={!scheduled} className={`${styles.secondary} ${styles.small}`} onClick={() => setForm((f) => ({ ...f, kind: "triggered" }))}>
            When something happens
          </button>
        </fieldset>
        {scheduled ? (
          <div className={styles.grid2}>
            <div className={admin.field}>
              <label className={admin.label} htmlFor="bot-every">
                Runs
              </label>
              <select id="bot-every" className={admin.select} value={form.every} onChange={set("every")}>
                <option value="hours">Every few hours</option>
                <option value="day">Daily</option>
                <option value="weekday">Weekdays</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
              </select>
            </div>
            {form.every === "hours" ? field("every_hours", "Every how many hours", { inputMode: "numeric" }) : field("at_time", "At", { type: "time" })}
          </div>
        ) : (
          <div className={styles.grid2}>
            {field("trigger_text", "What sets it off (the client reads this)", { maxLength: 300, placeholder: "A new invoice arrives in the AP inbox" })}
            <div className={admin.field}>
              <label className={admin.label} htmlFor="bot-safety_every">
                Should run at least once every
              </label>
              <select id="bot-safety_every" className={admin.select} value={form.safety_every} onChange={set("safety_every")}>
                <option value="">No safety net</option>
                <option value="weekday">Weekday</option>
                <option value="day">Day</option>
                <option value="week">Week</option>
              </select>
            </div>
          </div>
        )}
        <p className={styles.status}>
          {scheduled || form.safety_every
            ? "Late once a run is half an interval overdue. Stopped after two missed runs. Needs attention when the last run failed."
            : "With no safety net it is never Late or Stopped, only Needs attention when a run fails."}
        </p>
        <div className={styles.grid2}>
          {field("item_noun", "One item is a", { maxLength: 60, placeholder: "invoice" })}
          {field("minutes_per_item", "Agreed minutes saved per item", { inputMode: "decimal" })}
          {field("hourly_rate", `Agreed hourly rate (${form.currency})`, { inputMode: "decimal" })}
          <div className={admin.field}>
            <label className={admin.label} htmlFor="bot-currency">
              Currency
            </label>
            <select id="bot-currency" className={admin.select} value={form.currency} onChange={set("currency")}>
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
            </select>
          </div>
          {field("agreed_on", "Agreed on", { type: "date" })}
        </div>

        {GROK_SETUP_SHOWN ? (
          <div className={styles.setupBox}>
            <div className={styles.formRow}>
              <span>
                Grok Bot setup. Bot code <code>{form.code}</code>
              </span>
              <button
                type="button"
                className={`${styles.secondary} ${styles.small}`}
                onClick={() => {
                  void navigator.clipboard?.writeText(setupText(form.code, form.item_noun ?? "item"));
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy setup instructions"}
              </button>
            </div>
            <pre className={styles.setupText}>{setupText(form.code, form.item_noun ?? "item")}</pre>
          </div>
        ) : null}

        {view ? (
          <div>
            <p className={styles.status}>
              {view.health.reason ? `${view.health.reason}. ` : ""}
              {view.savings.runs} {view.savings.runs === 1 ? "run" : "runs"} reported, {view.savings.runsThisWeek} this week.
            </p>
            {view.recent.length > 0 ? (
              <ul className={styles.plainList}>
                {view.recent.slice(0, 5).map((r) => (
                  <li key={r.ran_at}>
                    <span className={styles.muted}>{new Date(r.ran_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</span>
                    <span>
                      {r.result === "worked" ? `Worked, ${r.items} ${r.items === 1 ? "item" : "items"}` : `Failed${r.note ? `: ${r.note}` : ""}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.status}>No runs reported since it was added on {shortDate(view.bot.created_at)}.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
