"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import {
  addAutomationsFromDiagnosticAction,
  deleteAutomationAction,
  deleteBotAction,
  saveAutomationAction,
  saveBotAction,
  type AutomationInput,
  type BotInput,
} from "@/lib/diagnostics/actions";
import { suggestBotCode } from "@/lib/diagnostics/bots";
import type { BotView } from "@/lib/diagnostics/service";
import { BotChip, BotSection, seedBot } from "./BotSection";
import { AUTOMATION_STAGES, stageLabel, type AutomationRow } from "@/lib/diagnostics/types";
import { useDxAction } from "../../useDxAction";
import { shortDate } from "../../format";
import admin from "../../../admin/companies/admin.module.css";
import styles from "../../diagnostics.module.css";

// A client's automations (0306): the mini project view a system admin
// keeps, and the client will read once client logins exist. Each row
// opens the drawer to change its stage, dates, champion and latest
// update. The first ones come from the newest diagnostic's first win
// and roadmap. An automation's bot (0308) is edited in the same drawer.

const STAGE_TONE: Record<string, string> = {
  live: "",
  testing: styles.chipWarn,
  building: styles.chipInfo,
  planned: styles.chipMuted,
  paused: styles.chipMuted,
};

export function StageChip({ stage }: { stage: string }) {
  return <span className={`${styles.chip} ${STAGE_TONE[stage] ?? styles.chipMuted}`}>{stageLabel(stage)}</span>;
}

function buildDates(a: AutomationRow): string {
  if (a.build_starts && a.goes_live) return `${shortDate(a.build_starts)} to ${shortDate(a.goes_live)}`;
  if (a.goes_live) return `Goes live ${shortDate(a.goes_live)}`;
  if (a.build_starts) return `Starts ${shortDate(a.build_starts)}`;
  return "Not set";
}

export function Automations({
  clientId,
  clientName,
  country,
  automations,
  bots,
  sourceId,
  archived,
}: {
  clientId: string;
  clientName: string;
  country: string | null;
  automations: AutomationRow[];
  bots: BotView[];
  sourceId: string | null;
  archived: boolean;
}) {
  const botOf = new Map(bots.map((b) => [b.automation.id, b]));
  const [editing, setEditing] = useState<AutomationRow | "new" | null>(null);
  const from = useDxAction();
  const [note, setNote] = useState<string | null>(null);

  return (
    <section className={styles.card} aria-labelledby="client-automations">
      <div className={styles.cardHeader}>
        <h2 id="client-automations" className={styles.cardTitle}>
          Automations
        </h2>
        <span className={styles.cardMeta}>{automations.length}</span>
        {archived ? null : (
          <span className={`${styles.headerAction} ${styles.formRow}`}>
            {sourceId ? (
              <button
                type="button"
                className={`${styles.secondary} ${styles.small}`}
                disabled={from.pending}
                onClick={() => {
                  setNote(null);
                  from.run(async () => {
                    const r = await addAutomationsFromDiagnosticAction(sourceId);
                    if (r.ok && !r.added) setNote("Everything from the diagnostic is already here.");
                    return r;
                  });
                }}
              >
                Add from the diagnostic
              </button>
            ) : null}
            <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setEditing("new")}>
              Add an automation
            </button>
          </span>
        )}
      </div>
      {from.error || note ? (
        <p className={`${styles.body} ${from.error ? styles.error : styles.status}`} role={from.error ? "alert" : "status"}>
          {from.error ?? note}
        </p>
      ) : null}
      {automations.length === 0 ? (
        <p className={styles.empty}>
          None yet. {sourceId ? "Add from the diagnostic to start with its first win and roadmap, or add one by hand." : "Add one by hand."}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Automation</th>
                <th>Stage</th>
                <th>Build</th>
                <th>Champion</th>
                <th>Bot</th>
                <th>Latest update</th>
              </tr>
            </thead>
            <tbody>
              {automations.map((a) => (
                <tr key={a.id}>
                  <td>
                    <button type="button" className={`${styles.link} ${styles.linkButton}`} onClick={() => setEditing(a)}>
                      {a.title}
                    </button>
                  </td>
                  <td>
                    <StageChip stage={a.stage} />
                  </td>
                  <td className={styles.muted}>{buildDates(a)}</td>
                  <td>{a.champion ?? ""}</td>
                  <td>{botOf.get(a.id) ? <BotChip status={botOf.get(a.id)!.health.status} /> : <span className={styles.muted}>No bot</span>}</td>
                  <td>
                    {a.latest_update ?? ""}
                    {a.latest_update_at ? <span className={styles.muted}> ({shortDate(a.latest_update_at)})</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? (
        <AutomationDrawer
          clientId={clientId}
          clientName={clientName}
          country={country}
          automation={editing === "new" ? null : editing}
          bot={editing === "new" ? null : botOf.get(editing.id) ?? null}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

function seed(a: AutomationRow | null): AutomationInput {
  return {
    title: a?.title ?? "",
    stage: a?.stage ?? "planned",
    build_starts: a?.build_starts ?? "",
    goes_live: a?.goes_live ?? "",
    champion: a?.champion ?? "",
    latest_update: a?.latest_update ?? "",
  };
}

function AutomationDrawer({
  clientId,
  clientName,
  country,
  automation,
  bot,
  onClose,
}: {
  clientId: string;
  clientName: string;
  country: string | null;
  automation: AutomationRow | null;
  bot: BotView | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<AutomationInput>(() => seed(automation));
  const [hasBot, setHasBot] = useState(Boolean(bot));
  const [botForm, setBotForm] = useState<BotInput>(() => seedBot(bot, suggestBotCode(clientName, automation?.title ?? ""), country));
  const [removingBot, setRemovingBot] = useState(false);
  const { pending, error, run } = useDxAction();
  const set = (k: keyof AutomationInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const id = automation?.id ?? null;

  const input = (k: keyof AutomationInput, label: string, props: Record<string, unknown> = {}) => (
    <div className={admin.field}>
      <label className={admin.label} htmlFor={`automation-${k}`}>
        {label}
      </label>
      <input id={`automation-${k}`} className={admin.input} value={form[k] ?? ""} onChange={set(k)} {...props} />
    </div>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      name="diagnostic-automation"
      eyebrow={automation ? "Edit automation" : "Add an automation"}
      title={automation?.title ?? "New automation"}
      footer={
        <>
          <button
            type="button"
            className={styles.primary}
            onClick={() =>
              run(async () => {
                const saved = await saveAutomationAction(clientId, id, form);
                if (!saved.ok || !hasBot) return saved;
                return saveBotAction(clientId, saved.id ?? id ?? "", botForm);
              }, onClose)
            }
            disabled={pending}
          >
            Save
          </button>
          <button type="button" className={styles.secondary} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          {id ? (
            <button type="button" className={styles.danger} onClick={() => run(() => deleteAutomationAction(clientId, id), onClose)} disabled={pending}>
              Remove
            </button>
          ) : null}
          {error ? <span className={styles.error} role="alert">{error}</span> : null}
        </>
      }
    >
      <div className={styles.body}>
        {input("title", "Automation", { maxLength: 300, autoFocus: !automation })}
        <div className={admin.field}>
          <label className={admin.label} htmlFor="automation-stage">
            Stage
          </label>
          <select id="automation-stage" className={admin.select} value={form.stage} onChange={set("stage")}>
            {AUTOMATION_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.grid2}>
          {input("build_starts", "Build starts", { type: "date" })}
          {input("goes_live", "Goes live", { type: "date" })}
        </div>
        {input("champion", "Champion", { maxLength: 200, placeholder: "Name and role" })}
        <div className={admin.field}>
          <label className={admin.label} htmlFor="automation-latest_update">
            Latest update for the client
          </label>
          <textarea id="automation-latest_update" className={styles.textarea} value={form.latest_update} onChange={set("latest_update")} maxLength={2000} />
        </div>
      </div>
      {hasBot ? (
        <>
          <BotSection form={botForm} setForm={setBotForm} view={bot} />
          {bot ? (
            <div className={`${styles.body} ${styles.formRow}`}>
              {removingBot ? (
                <>
                  <button type="button" className={`${styles.danger} ${styles.small}`} disabled={pending} onClick={() => run(() => deleteBotAction(clientId, bot.bot.id), onClose)}>
                    Remove the bot and its runs
                  </button>
                  <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setRemovingBot(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setRemovingBot(true)}>
                  Remove the bot
                </button>
              )}
            </div>
          ) : (
            <div className={styles.body}>
              <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setHasBot(false)}>
                No bot after all
              </button>
            </div>
          )}
        </>
      ) : (
        <div className={styles.body}>
          <button
            type="button"
            className={`${styles.secondary} ${styles.small}`}
            onClick={() => {
              setBotForm((f) => ({ ...f, code: f.code || suggestBotCode(clientName, form.title) }));
              setHasBot(true);
            }}
          >
            Add a bot
          </button>
        </div>
      )}
    </Drawer>
  );
}
