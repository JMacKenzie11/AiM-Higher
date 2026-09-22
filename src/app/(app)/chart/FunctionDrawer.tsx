"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "@/components/ui/Drawer";
import {
  createFunctionCompetencyAction,
  createFunctionDecisionRightAction,
  deleteFunctionCompetencyAction,
  deleteFunctionDecisionRightAction,
  renameFunctionCompetencyAction,
  renameFunctionDecisionRightAction,
} from "@/lib/chart/actions";
import {
  loadFunctionDrawerAction,
  type FunctionDrawerDetail,
} from "@/lib/chart/function-drawer";
import { SeatEditor } from "./function/[id]/SeatEditor";
import { RolesList } from "./function/[id]/RolesList";
import { FunctionTitleEditor } from "./function/[id]/FunctionTitleEditor";
import { DeleteFunctionButton } from "./function/[id]/DeleteFunctionButton";
import { SimpleFunctionItemList } from "./function/[id]/SimpleFunctionItemList";
import { ReadinessChecklist } from "./function/[id]/ReadinessChecklist";
import styles from "./chart.module.css";

// The function's detail, opened over the chart.
//
// Everything the /chart/function/[id] page shows is here, drawn by
// the same components that page uses — one seat editor, one roles
// list, one readiness card. The page stays for deep links, for the
// role description underneath it, and for anyone who lands on it
// from outside; what changed is that clicking a card on the chart
// no longer has to leave the chart to change a name.
//
// ---- WHY IT FETCHES ON OPEN ------------------------------------
//
// The chart renders one card per function and there can be twenty.
// getChartFunctionDetail is eight queries, so loading every
// function's detail with the page to have it ready would be eight
// queries times twenty, for a panel that opens over one of them.
// The drawer asks when it opens instead. The cost is a moment of
// "Loading…" the first time; the alternative was a page that got
// slower with every function a company added.
//
// ---- WHY onChanged IS EVERYWHERE -------------------------------
//
// On the detail page these editors are part of the RSC tree, so
// revalidatePath inside each action redraws them with the new
// values for free. Here they are fed from `detail`, which is client
// state that no server revalidation can reach. Every editor gets a
// refetch, and the refetch is also what keeps the readiness gates
// honest: add a decision right and the checklist below it ticks
// over in the same beat.

export function FunctionDrawer({
  functionId,
  onClose,
  onSwitch,
}: {
  functionId: string | null;
  onClose: () => void;
  // Sub-functions and the parent line move the drawer rather than
  // opening a second one. The owner of `functionId` does the moving.
  onSwitch: (id: string) => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<FunctionDrawerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const load = useCallback(
    (id: string) => {
      startLoading(async () => {
        const result = await loadFunctionDrawerAction(id);
        if (result.ok) {
          setDetail(result.detail);
          setError(null);
        } else {
          setDetail(null);
          setError(result.message);
        }
      });
    },
    []
  );

  // Clearing `detail` on the way in matters: without it the panel
  // spends the fetch showing the function you opened LAST, under
  // the heading of the one you just clicked.
  useEffect(() => {
    if (!functionId) return;
    setDetail(null);
    setError(null);
    load(functionId);
  }, [functionId, load]);

  const refresh = useCallback(() => {
    if (functionId) load(functionId);
    // The cards behind the panel carry the seat and the
    // responsibilities too, so they go stale on the same edits.
    router.refresh();
  }, [functionId, load, router]);

  const open = functionId !== null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      name="chart-function"
      eyebrow="Function"
      title={
        detail ? (
          <FunctionTitleEditor
            functionId={detail.fn.id}
            initialTitle={detail.fn.title}
            canEdit={detail.canEdit}
            onRenamed={(next) => {
              setDetail((prev) =>
                prev ? { ...prev, fn: { ...prev.fn, title: next } } : prev
              );
              router.refresh();
            }}
          />
        ) : (
          "Function"
        )
      }
    >
      {error ? (
        <p role="alert" className={styles.fnDrawerError}>
          {error}
        </p>
      ) : null}

      {!detail && !error ? (
        <p className={styles.fnDrawerStatus}>Loading…</p>
      ) : null}

      {detail ? (
        <>
          {detail.parent ? (
            <ParentLine parent={detail.parent} onSwitch={onSwitch} />
          ) : null}

          <section
            className={styles.fnDrawerSection}
            aria-labelledby="fn-drawer-seat"
          >
            <h3 id="fn-drawer-seat" className={styles.fnDrawerSectionTitle}>
              In the seat
            </h3>
            <SeatEditor
              functionId={detail.fn.id}
              currentSeatHolder={detail.seatHolder}
              roster={detail.roster}
              canEdit={detail.canEdit}
              onChanged={refresh}
            />
          </section>

          <section
            className={styles.fnDrawerSection}
            aria-labelledby="fn-drawer-roles"
          >
            <h3 id="fn-drawer-roles" className={styles.fnDrawerSectionTitle}>
              Roles &amp; Responsibilities
            </h3>
            <RolesList
              functionId={detail.fn.id}
              roles={detail.roles}
              canEdit={detail.canEdit}
              rdEnabled={detail.rdEnabled}
              onChanged={refresh}
            />
          </section>

          {detail.rdEnabled ? (
            <>
              <section
                className={styles.fnDrawerSection}
                aria-labelledby="fn-drawer-decisions"
              >
                <h3
                  id="fn-drawer-decisions"
                  className={styles.fnDrawerSectionTitle}
                >
                  Decision Rights
                </h3>
                <SimpleFunctionItemList
                  functionId={detail.fn.id}
                  items={detail.decisionRights}
                  canEdit={detail.canEdit}
                  singularLabel="decision right"
                  addPlaceholder="Add a decision this role can make without escalation"
                  suggestTarget="decision_rights"
                  suggestButtonLabel="Suggest decision rights"
                  createAction={createFunctionDecisionRightAction}
                  renameAction={renameFunctionDecisionRightAction}
                  deleteAction={deleteFunctionDecisionRightAction}
                  onChanged={refresh}
                />
              </section>

              <section
                className={styles.fnDrawerSection}
                aria-labelledby="fn-drawer-competencies"
              >
                <h3
                  id="fn-drawer-competencies"
                  className={styles.fnDrawerSectionTitle}
                >
                  Competency Indicators
                </h3>
                <SimpleFunctionItemList
                  functionId={detail.fn.id}
                  items={detail.competencies}
                  canEdit={detail.canEdit}
                  singularLabel="competency indicator"
                  addPlaceholder="Add an observable behavior that shows excellence in this seat"
                  suggestTarget="competencies"
                  suggestButtonLabel="Suggest competency indicators"
                  createAction={createFunctionCompetencyAction}
                  renameAction={renameFunctionCompetencyAction}
                  deleteAction={deleteFunctionCompetencyAction}
                  onChanged={refresh}
                />
              </section>
            </>
          ) : null}

          {detail.children.length > 0 ? (
            <section
              className={styles.fnDrawerSection}
              aria-labelledby="fn-drawer-subs"
            >
              <h3 id="fn-drawer-subs" className={styles.fnDrawerSectionTitle}>
                Sub-functions
              </h3>
              <ul className={styles.fnDrawerSubList}>
                {detail.children.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={styles.fnDrawerJump}
                      onClick={() => onSwitch(c.id)}
                    >
                      {c.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.readiness ? (
            <section className={styles.fnDrawerSection}>
              {/* anchorGates off: the gates' hrefs are ids on the
                  detail page's sections, and following one from
                  inside the panel would scroll the chart behind it
                  to nowhere. In here the section a gate names is
                  already a thumb's reach away. */}
              <ReadinessChecklist
                gates={detail.readiness.gates}
                readyCount={detail.readiness.readyCount}
                total={detail.readiness.total}
                viewHref={`/chart/function/${detail.fn.id}/role-description`}
                hasBeenCreated={detail.readiness.hasBeenCreated}
                canEdit={detail.canEdit}
                anchorGates={false}
                headingId="fn-drawer-readiness"
              />
            </section>
          ) : null}

          <section className={styles.fnDrawerSection}>
            <a
              href={`/chart/function/${detail.fn.id}`}
              className={styles.crumb}
            >
              Open the full function page →
            </a>
          </section>

          {detail.canEdit ? (
            <div className={styles.fnDrawerDanger}>
              <DeleteFunctionButton
                functionId={detail.fn.id}
                functionTitle={detail.fn.title}
                hasChildren={detail.children.length > 0}
                onDeleted={onClose}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {/* Marks a refetch that is replacing values already on screen,
          which the "Loading…" above cannot: that only renders when
          there is nothing to show yet. */}
      {loading && detail ? (
        <p className={styles.fnDrawerStatus} aria-live="polite">
          Saving…
        </p>
      ) : null}
    </Drawer>
  );
}

function ParentLine({
  parent,
  onSwitch,
}: {
  parent: { id: string; title: string };
  onSwitch: (id: string) => void;
}) {
  return (
    <p className={styles.fnDrawerParent}>
      Part of{" "}
      <button
        type="button"
        className={styles.fnDrawerJump}
        onClick={() => onSwitch(parent.id)}
      >
        {parent.title}
      </button>
    </p>
  );
}
