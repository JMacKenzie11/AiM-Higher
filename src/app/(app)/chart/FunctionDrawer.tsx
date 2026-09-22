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
import { RolesList } from "./function/[id]/RolesList";
import { DeleteFunctionButton } from "./function/[id]/DeleteFunctionButton";
import { SimpleFunctionItemList } from "./function/[id]/SimpleFunctionItemList";
import { ReadinessChecklist } from "./function/[id]/ReadinessChecklist";
import { FunctionDetailsForm } from "./FunctionDetailsForm";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import styles from "./chart.module.css";

// The function's detail, opened over the chart.
//
// Everything the /chart/function/[id] page shows is here, drawn by
// the same components that page uses — one seat editor, one roles
// list, one readiness card. There is nothing on the page that is
// not here, so the drawer does not offer a way over to it: a link
// to a second copy of what you are already looking at is a question
// ("is there more over there?") with the answer no.
//
// The page is still there and still the destination for a deep
// link, for a team member, and for the role description underneath
// it. It is simply not somewhere this panel sends anybody.
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

// Stands in for "there is no destination, just close". A uuid can
// never collide with it.
const CLOSE = "__close__";

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
  // Details batch behind a Save now, so Escape, the X and a click on
  // the scrim can all throw typed work away. They ask first.
  const [dirty, setDirty] = useState(false);
  // Null means "not asking". A string means "asking, and this is the
  // function to move to once they say discard"; the close case uses
  // the sentinel below because there is no id to go to.
  const [pendingExit, setPendingExit] = useState<string | null>(null);

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
    setDirty(false);
    load(functionId);
  }, [functionId, load]);

  // One gate for every way out: the X, Escape, and the scrim all
  // route through the Drawer's onClose.
  const requestClose = useCallback(() => {
    if (dirty) {
      setPendingExit(CLOSE);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  const discardAndClose = useCallback(() => {
    setPendingExit(null);
    setDirty(false);
    onClose();
  }, [onClose]);

  // Switching to a sub-function replaces the form under the reader,
  // which loses unsaved edits just as surely as closing does. Same
  // question, same dialog, different destination.
  const requestSwitch = useCallback(
    (id: string) => {
      if (dirty) {
        setPendingExit(id);
        return;
      }
      onSwitch(id);
    },
    [dirty, onSwitch]
  );

  const discardAndGo = useCallback(() => {
    const target = pendingExit;
    setPendingExit(null);
    setDirty(false);
    if (target === null) return;
    if (target === CLOSE) onClose();
    else onSwitch(target);
  }, [pendingExit, onClose, onSwitch]);

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
      onClose={requestClose}
      name="chart-function"
      eyebrow="Function"
      title={detail?.fn.title ?? "Function"}
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
          <section
            className={styles.fnDrawerSection}
            aria-labelledby="fn-drawer-details"
          >
            <h3 id="fn-drawer-details" className={styles.fnDrawerSectionTitle}>
              Details
            </h3>
            <FunctionDetailsForm
              key={detail.fn.id}
              functionId={detail.fn.id}
              initial={{
                title: detail.fn.title,
                parentFunctionId: detail.parent?.id ?? null,
                leadId: detail.seatHolder?.id ?? null,
              }}
              parentOptions={detail.parentOptions}
              roster={detail.roster}
              canEdit={detail.canEdit}
              onDirtyChange={setDirty}
              onSaved={(values) => {
                // The head carries the name, and it is client state
                // that no server revalidation reaches. Without this
                // the panel keeps the old name over a chart that
                // already shows the new one.
                setDetail((prev) =>
                  prev
                    ? { ...prev, fn: { ...prev.fn, title: values.title } }
                    : prev
                );
                setDirty(false);
                refresh();
              }}
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
                      onClick={() => requestSwitch(c.id)}
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

          {detail.canEdit ? (
            <div className={styles.fnDrawerDanger}>
              <DeleteFunctionButton
                functionId={detail.fn.id}
                functionTitle={detail.fn.title}
                hasChildren={detail.children.length > 0}
                onDeleted={discardAndClose}
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

      {/* Branded, not window.confirm, for the reason
          DeleteFunctionButton gives: a native modal on a shared
          meeting screen is a different kind of interruption. */}
      <ConfirmDialog
        open={pendingExit !== null}
        title="Discard your changes?"
        message="The name, where this function sits, and who's in the seat haven't been saved yet. Responsibilities you added or removed are already saved."
        confirmLabel="Discard"
        tone="danger"
        onConfirm={discardAndGo}
        onCancel={() => setPendingExit(null)}
      />
    </Drawer>
  );
}
