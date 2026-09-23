"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  logMeasureEntriesAction,
  type MeasureEntryInput,
} from "@/lib/measures/actions";
import { storageWeekFor } from "@/lib/measures/frequency";
import { monthKeyOf, monthLabel } from "@/lib/measures/months";
import type { GridData, GridRow,
  GridGroup,
} from "@/lib/measures/grid";
import { EditMeasureForm, ArchiveMeasureButton } from "./EditMeasureForm";
import { ExternalMeasureNote } from "./external/ExternalMeasureNote";
import { ExternalSourceControls } from "./external/ExternalSourceControls";
import { PencilIcon } from "@/components/ui/PencilIcon";
import { PlusIcon } from "@/components/ui/PlusIcon";
import { formatWeekBeginning, mondayOf } from "@/lib/dates";
import {
  formatMeasureValue,
  parseTypedNumber,
  toEntryNumber,
} from "@/lib/measures/value-format";
import uiStyles from "@/components/ui/ui.module.css";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderMeasuresAction } from "@/lib/measures/reorder-actions";
import { reorderFunctionsAction } from "@/lib/chart/actions";
import { Drawer } from "@/components/ui/Drawer";
import styles from "./measures.module.css";

// The /measures grid.
//
// Functional Area | Owner | Critical Success Factor | Frequency |
// Target | one column per week, a rolling year of them.
//
// ---- WHY A TABLE AND NOT THE CSS GRID THAT WAS HERE ----------
//
// The page was a CSS grid with `display: contents` rows, which places
// every cell against the parent's tracks. That works when the column
// count is fixed. Here it is not: a month collapses to one column and
// expands to four or five, so the track list changes as you click.
//
// A table does the two things that then matter for free: rows stay
// aligned however many cells a header spans, and the first columns
// pin with `position: sticky` while the weeks scroll under them. The
// old grid needed a test to catch a row emitting the wrong number of
// cells (grid-alignment.test.ts); colspan is checked by the browser.
//
// ---- MONTH STATE IS REACT'S, AND THAT IS SAFE HERE -----------
//
// The plan toolbar keeps its panels as native <details> because React
// state there discarded an in-flight router.refresh() and a created
// row never appeared. Nothing here is a form submission: opening a
// month is local, and the save below goes through useTransition,
// which preserves this component's state across the refresh.
//
// ---- SETTINGS OPEN IN A DRAWER, NOT IN THE TABLE -------------
//
// They opened in a full-width row beneath the measure, and that row
// had a bug with a long history: Cancel needed clicking twice.
//
// The critique panel sits ABOVE the button row, so anything that
// makes it grow between mousedown and mouseup moves the buttons out
// from under the pointer and the click never lands.
// `shouldCritiqueOnBlur` was written to stop that by skipping the
// critique when focus moves to a button, and it does not always get
// the chance: a browser that does not focus a button on mousedown
// reports `relatedTarget` as null, which is an ordinary blur as far
// as that guard can tell.
//
// critique-blur.ts said as much when it was written: "this fixes the
// trigger, not the underlying fragility... the durable fix is for the
// critique panel to not occupy layout above the action row." This is
// that fix. The drawer scrolls its own body and pins Save and Cancel
// in a footer, so the panel can grow to any height and the buttons do
// not move a pixel.
//
// ---- TWO COLUMNS TAKE INPUT, NOT ONE -------------------------
//
// A week stays open until the end of the following one. The current
// column and the one that just closed both accept a value; everything
// older is read to.
//
// It was the current column alone, which put the page at odds with
// the Saturday nudge. That runs on a Saturday, asks for the week that
// has just CLOSED, and makes it due the coming Friday. By then this
// page had already locked that week, so the only box on offer was the
// new one and following the nudge recorded the number against the
// wrong week.
//
// A week locks when the next Saturday comes round, which is the same
// moment the nudge stops asking for it. One rule, stated once, in two
// places that now agree.
//
// Older weeks stay read-only. A grid where any of fifty-two cells is
// editable invites somebody to quietly correct a number from April;
// fixing one of those is a conversation, not a keystroke.

// THE PINNED COLUMNS' WIDTHS.
//
// Applied through a <colgroup> on a `table-layout: fixed` table, so
// the browser sizes the columns from these rather than from their
// content.
//
// THE STICKY OFFSETS ARE NOT COMPUTED FROM THEM. That was the second
// attempt and it was still wrong by a few pixels per column: cell
// borders sit outside the column width the colgroup declares, so the
// running sum of these numbers is not where the next column actually
// starts. The pinned block drifted as the weeks scrolled under it,
// by one pixel at Owner and thirty by Target.
//
// So the offsets are MEASURED from the rendered header, once, in the
// same frame that sizes the weeks. Whatever borders and padding
// actually do, the sticky positions agree with them by construction.
const PINNED: ReadonlyArray<{ key: string; width: number }> = [
  { key: "area", width: 150 },
  { key: "owner", width: 100 },
  // The row's drag handle, asked for in this position: "between the
  // owner and the CSF description". It travels with the authoring
  // columns, so a reader with no seat anywhere is not given 36px of
  // permanently empty table.
  { key: "drag", width: 36 },
  { key: "actions", width: 64 },
  { key: "name", width: 240 },
  { key: "freq", width: 96 },
  { key: "target", width: 84 },
];

function pinnedColumns(authoring: boolean) {
  return PINNED.filter(
    (c) => authoring || (c.key !== "actions" && c.key !== "drag")
  );
}

// A collapsed month is one narrow column; a week is sized on mount to
// fill whatever is left, so the open month lands exactly against the
// pinned block.
const CLOSED_MONTH_WIDTH = 44;
const MIN_WEEK_WIDTH = 72;

// A new measure, before anything is typed. The column defaults,
// restated here so the form has something to control.
const BLANK_MEASURE = {
  id: "",
  description: "",
  target: null,
  value_type: "number" as const,
  value_scale: "plain",
  target_direction: "higher_is_better" as const,
  update_frequency: "weekly",
  show_on_dashboard: true,
};

export function MeasuresGrid({
  data,
  weekEnding,
  isAdmin,
}: {
  data: GridData;
  weekEnding: string;
  // Whether this caller administers the whole company. It no longer
  // decides whether the authoring controls appear: 0217 admits a
  // function's Lead to their own measures, so that question is asked
  // per function through `canLog`, which carries the same answer.
  // This only decides whether the actions COLUMN exists at all, so a
  // reader with no seat anywhere is not given a permanently empty
  // 64px of table.
  isAdmin: boolean;
}) {
  // The actions column shows if this caller can author anywhere.
  const authoring = isAdmin || data.groups.some((g) => g.canLog);

  // ---- DRAG TO REORDER ------------------------------------------
  //
  // Two levels, and they are two different permissions.
  //
  //   A FUNCTIONAL AREA moves among its SIBLINGS. This page renders
  //   the chart's hierarchy flattened, so a drag across parents would
  //   be a chart edit wearing a grid's clothes and the next render
  //   would undo it. In practice it reads as a flat reorder: every
  //   company on the fleet nests nearly every function under one
  //   parent, so the areas people reorder are already siblings.
  //   It writes through reorderFunctionsAction, which is admin and
  //   guide only — arranging the chart is not a Lead's call.
  //
  //   A CRITICAL SUCCESS FACTOR moves within its own area, and that
  //   is open to whoever may author it: admin, guide, or the
  //   function's Lead. Same rule as the pencil beside it, asked
  //   through `canLog` rather than restated.
  //
  // Both orders are OPTIMISTIC and revert on refusal, and both take
  // the server's order verbatim whenever nothing is in flight —
  // `data` changes on every unrelated edit to this page.
  const [groupOrder, setGroupOrder] = useState(data.groups);
  const [rowOverrides, setRowOverrides] = useState<Record<string, GridRow[]>>(
    {}
  );
  const [reorderPending, startReorder] = useTransition();
  const [reorderError, setReorderError] = useState<string | null>(null);

  useEffect(() => {
    if (reorderPending) return;
    setGroupOrder(data.groups);
    setRowOverrides({});
  }, [data.groups, reorderPending]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Only groups that render. An empty area has no rows to drag and
  // no row to hang an area handle on.
  const areaIds = groupOrder.filter((g) => g.rows.length > 0).map((g) => g.functionId);

  // COLLISIONS ARE CONFINED TO THE LEVEL BEING DRAGGED, and this is
  // not a refinement — without it the area drag does nothing at all.
  //
  // Both levels register droppables in the same DndContext, so plain
  // closestCenter answers a dragging <tbody> with whichever <tr> is
  // nearest its centre, which is always one of its own rows. The drop
  // handler then looks that id up among the groups, finds nothing,
  // and returns. Measured: six areas, six handles, and not one of
  // them moved.
  //
  // Filtering the candidates by what is being dragged makes each
  // gesture see only its own kind.
  const groupIdSet = new Set(groupOrder.map((g) => g.functionId));
  const collisionDetection = useCallback(
    (args: Parameters<typeof closestCenter>[0]) => {
      const activeIsGroup = groupIdSet.has(String(args.active.id));
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((container) =>
          activeIsGroup
            ? groupIdSet.has(String(container.id))
            : !groupIdSet.has(String(container.id))
        ),
      });
    },
    // groupIdSet is rebuilt each render from groupOrder, which is the
    // only thing that changes what is a group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupOrder]
  );

  function siblingIds(group: GridGroup): string[] {
    return groupOrder
      .filter(
        (g) =>
          g.rows.length > 0 && g.parentFunctionId === group.parentFunctionId
      )
      .map((g) => g.functionId);
  }

  function rowOrder(group: GridGroup): GridRow[] {
    return rowOverrides[group.functionId] ?? group.rows;
  }

  // Moving an area, once something has decided where it goes. The
  // pointer drag and the arrow keys both land here, so there is one
  // description of what a move means and one place it is saved.
  function moveArea(activeId: string, toIndex: number) {
    const from = groupOrder.findIndex((g) => g.functionId === activeId);
    if (from < 0 || toIndex < 0 || toIndex >= groupOrder.length) return;
    const group = groupOrder[from];
    if (groupOrder[toIndex].parentFunctionId !== group.parentFunctionId) return;

    const previous = groupOrder;
    const next = arrayMove(groupOrder, from, toIndex);
    setGroupOrder(next);
    setReorderError(null);
    // Only this parent's children are renumbered. The action takes
    // "one parent's children in their new order", so handing it a
    // flattened whole-page order would renumber cousins against each
    // other and scramble the chart.
    const siblings = next.filter(
      (g) => g.parentFunctionId === group.parentFunctionId
    );
    startReorder(async () => {
      const result = await reorderFunctionsAction(
        siblings.map((g, index) => ({ id: g.functionId, sort_order: index }))
      );
      if (!result.ok) {
        setGroupOrder(previous);
        setReorderError(result.message);
      }
    });
  }

  // THE ARROW KEYS ARE NOT A CONVENIENCE, they are the only keyboard
  // path this control has.
  //
  // dnd-kit's KeyboardSensor cannot navigate between <tbody>
  // droppables: picking an area up and pressing Down reports "moved
  // over" the area it started on, every time, on all six. The
  // pointer drag works — measured, an area moved from first to third
  // — so the gesture is sound and only its keyboard half is not.
  // Rather than ship a control a keyboard cannot reach, Up and Down
  // move the area directly while its handle has focus.
  function handleAreaKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    functionId: string
  ) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const from = groupOrder.findIndex((g) => g.functionId === functionId);
    if (from < 0) return;
    event.preventDefault();
    moveArea(functionId, from + (event.key === "ArrowDown" ? 1 : -1));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    setReorderError(null);

    // A group id or a measure id? The grid's own data answers it,
    // rather than a prefix that would have to be parsed back off.
    const activeGroup = groupOrder.find((g) => g.functionId === activeId);
    if (activeGroup) {
      const overGroup =
        groupOrder.find((g) => g.functionId === overId) ??
        // Belt and braces: if a drop ever resolves onto a row rather
        // than its body, take the area that row belongs to.
        groupOrder.find((g) => rowOrder(g).some((r) => r.id === overId));
      if (!overGroup) return;
      // Siblings only. A drop onto another parent's area is refused
      // silently: the row springs back, which is the truthful
      // outcome, and saying "that is a chart edit" over a table is
      // more noise than the gesture deserves.
      if (overGroup.parentFunctionId !== activeGroup.parentFunctionId) return;

      moveArea(
        activeId,
        groupOrder.findIndex((g) => g.functionId === overGroup.functionId)
      );
      return;
    }

    // A measure, then. It may only move inside the area it started
    // in; anything else is a different function's list.
    const owner = groupOrder.find((g) =>
      rowOrder(g).some((r) => r.id === activeId)
    );
    if (!owner) return;
    const rows = rowOrder(owner);
    const from = rows.findIndex((r) => r.id === activeId);
    const to = rows.findIndex((r) => r.id === overId);
    if (from < 0 || to < 0) return;

    const next = arrayMove(rows, from, to);
    setRowOverrides((prev) => ({ ...prev, [owner.functionId]: next }));
    startReorder(async () => {
      const result = await reorderMeasuresAction(
        owner.functionId,
        next.map((r) => r.id)
      );
      if (!result.ok) {
        setRowOverrides((prev) => ({ ...prev, [owner.functionId]: rows }));
        setReorderError(result.message);
      }
    });
  }
  // The functions this caller may add to. An admin gets all of them;
  // a Lead gets their own, which is the same rule reaching a
  // different answer rather than a second rule.
  const addableGroups = data.groups.filter((g) => g.canLog);
  // Open on the current month, with the rest closed. A rolling year
  // is 52 columns and nobody needs 52 at once; the week you are
  // filling in should be on screen without scrolling to it.
  const [openMonths, setOpenMonths] = useState<Set<string>>(
    () => new Set(data.months.filter((m) => m.isCurrent).map((m) => m.key))
  );

  // WHERE A TYPED VALUE LANDS. Itself for a weekly measure; the
  // month's own week for a monthly one, whichever box was used.
  // Storage does not move — see storageWeekFor.
  const storageWeek = (row: GridRow, week: string) =>
    storageWeekFor(row.frequency, week);

  // A MONTHLY MEASURE IS OPEN FOR ITS WHOLE MONTH.
  //
  // Without this the feature does not exist. A monthly value lives on
  // the month's last week, and the ordinary window is "this week and
  // the one just closed" — so on the 3rd, the week the value belongs
  // to is three weeks away and unwritable, which is precisely the
  // thing somebody asked to be able to do.
  //
  // The month stays open while its own week is still in the ordinary
  // window, so the grace after month end is the same grace every
  // other measure gets rather than a second rule.
  const monthIsOpen = (row: GridRow, week: string): boolean => {
    if (isAdmin) return true;
    const own = storageWeek(row, week);
    return monthKeyOf(week) === monthKeyOf(weekEnding) || openWeeks.includes(own);
  };

  const cellEditable = (row: GridRow, week: string): boolean =>
    row.frequency === "monthly"
      ? monthIsOpen(row, week)
      : editableWeeks.includes(week);

  // THE WEEKS THAT ARE STILL OPEN, which is not the same question as
  // the weeks this caller may type into.
  //
  // Open means open to everyone: the week that just closed and the
  // current one. That is what the column tint and its tooltip
  // describe, and it is the window the Friday nudge and the Saturday
  // sweep work to. Oldest first, so the grid reads left to right.
  const openWeeks = useMemo(
    () =>
      [data.previousWeekEnding, weekEnding].filter(
        (w): w is string => w !== null
      ),
    [data.previousWeekEnding, weekEnding]
  );

  // AN ADMIN MAY EDIT ANY WEEK ON THE PAGE, decided 2026-09-19.
  //
  // Correcting a number from two months ago was "a conversation
  // rather than a keystroke" — meaning somebody had to ask an
  // engineer. That is not a rule anybody chose, it is the absence of
  // a control, and the lock was never a boundary anyway: the entry
  // action has no week check at all, so the window was a disabled
  // input and nothing more.
  //
  // The window still exists for everyone else. It is what makes a
  // closed week a record rather than a running draft, and a Lead
  // quietly revising an old number is the thing it prevents.
  const editableWeeks = useMemo(
    () => (isAdmin ? data.weeks : openWeeks),
    [isAdmin, data.weeks, openWeeks]
  );

  // WHAT THE COUNT CHASES IS THE WEEK THAT JUST CLOSED, not the
  // current one, because that is the week with a deadline and the one
  // the Saturday nudge asks about. Two numbers describing one job
  // have to count the same things; the nudge counts the closed week,
  // so this does too. The current week is there to type into as you
  // go and is not late yet.
  const chasedWeek = data.previousWeekEnding ?? weekEnding;
  const writableRows = useMemo(
    () =>
      data.groups
        .filter((g) => g.canLog)
        .flatMap((g) => g.rows.filter((r) => isDueInWeek(r, chasedWeek))),
    [data.groups, chasedWeek]
  );

  // Keyed by measure AND week, because two weeks are editable.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      data.groups.flatMap((g) =>
        g.rows.flatMap((r) =>
          // Keyed by where the value LIVES, not by the column it is
          // shown in, so a monthly measure's four boxes are one entry
          // in this map and typing in any of them fills all four.
          editableWeeks.map((w) => {
            const own = storageWeekFor(r.frequency, w);
            return [cellKey(r.id, own), valueAt(r, own)];
          })
        )
      )
    )
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  // Which measure's settings are open in the drawer. One at a time,
  // by construction: it is one drawer.
  const [editing, setEditing] = useState<string | null>(null);
  // Which function the add panel is open on, or null.
  //
  // ADDING WAS LOST IN THE GRID REWRITE. Deleting FunctionSection
  // took its "Add a critical success factor" row with it and nothing
  // replaced it, so for one commit nobody could add a measure on this
  // page at all, admins included. This is that, restored: one panel
  // rather than a row per function, opened from a single control,
  // with the function chosen in it.
  const [adding, setAdding] = useState<string | null>(null);
  const editingRow = useMemo(
    () =>
      data.groups.flatMap((g) => g.rows).find((r) => r.id === editing) ?? null,
    [data.groups, editing]
  );

  // Escape closes it, like every other dismissible surface in the
  // app. The drawer traps nothing else: the table behind it stays
  // readable, which is the point of a drawer over a modal here.
  useEffect(() => {
    if (!editing && !adding) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setEditing(null);
      setAdding(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, adding]);

  // Open with the CURRENT MONTH against the pinned columns, and
  // every earlier month scrolled off to the left.
  //
  // Scrolling to the far right is not the same thing and was the
  // first attempt: it puts this week on screen but leaves two or
  // three collapsed months sitting between the measure names and the
  // weeks, which is exactly the history the collapse was supposed to
  // get out of the way.
  //
  // Measured from the rendered element rather than summed from the
  // pinned widths in CSS. Those widths are already duplicated between
  // the stylesheet and a test; a third copy here would be the one
  // that goes stale.
  const outstanding = writableRows.filter(
    (r) => !(values[cellKey(r.id, chasedWeek)] ?? "").trim()
  ).length;

  function toggleMonth(key: string) {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save() {
    setMessage(null);
    // ONLY WHAT CHANGED, compared against what the server currently
    // holds rather than against a remembered baseline — `data` is
    // refreshed after every save, so this corrects itself and there
    // is no second copy of the truth to keep in step.
    //
    // It used to send every editable cell, which was harmless while
    // that meant two columns. An admin can now edit a year of them,
    // and a save that posted a thousand unchanged cells would be
    // slow, would report a meaningless "Saved N values", and would
    // rewrite rows nobody touched.
    const entries: MeasureEntryInput[] = data.groups
      .filter((g) => g.canLog)
      .flatMap((g) =>
        g.rows.flatMap((r) =>
          // DEDUPED ONTO THE STORAGE WEEK. A monthly measure shows a
          // box in every week of its month and they are one value, so
          // without this a save would carry the same row four times.
          Array.from(
            new Set(editableWeeks.map((w) => storageWeekFor(r.frequency, w)))
          )
            .filter((w) => isDueInWeek(r, w))
            .filter((w) => (values[cellKey(r.id, w)] ?? "") !== valueAt(r, w))
            .map((w) => ({
              measureId: r.id,
              valueType: r.valueType,
              scale: r.scale,
              rawValue: values[cellKey(r.id, w)] ?? "",
              weekEnding: w,
            }))
        )
      );
    startTransition(async () => {
      const result = await logMeasureEntriesAction(entries, weekEnding);
      if (result.ok) {
        setMessage({
          ok: true,
          text:
            result.savedCount === 0
              ? "Nothing to save. Enter values first."
              : `Saved ${result.savedCount} value${result.savedCount === 1 ? "" : "s"}.`,
        });
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  // Every column the body has to emit, in order, so a row and the
  // header cannot disagree about how many cells there are.
  type Column =
    | { kind: "week"; key: string; month: string }
    | { kind: "month"; key: string; month: string };
  // WITH SUCCESS TRACKING OFF THERE ARE NO WEEKS. The page is a
  // place to write down what each function is held to, which is what
  // the help has always said it degrades to; rendering a year of
  // empty columns nobody can type into is not that.
  const visibleMonths = data.months;

  const columns = useMemo<Column[]>(
    () =>
      visibleMonths.flatMap((m): Column[] =>
        openMonths.has(m.key)
          ? m.weeks.map((w) => ({ kind: "week", key: w, month: m.key }))
          : [{ kind: "month", key: m.key, month: m.key }]
      ),
    [visibleMonths, openMonths]
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const scrollbarRowRef = useRef<HTMLDivElement>(null);
  // Whether the opening scroll has happened. After it has, the
  // position belongs to the reader.
  const openedRef = useRef(false);

  // One arrow press moves about a month. Smooth, so the eye can
  // follow which columns went by rather than being teleported.
  function nudge(direction: -1 | 1) {
    const grid = scrollRef.current;
    if (!grid) return;
    grid.scrollBy({
      left: direction * Math.max(160, Math.round(grid.clientWidth * 0.4)),
      behavior: "smooth",
    });
  }

  // THE THUMB IS DRAWN, NOT A NATIVE SCROLLBAR.
  //
  // The first two attempts were a second scrolling element mirrored
  // to this one, styled to look like a bar. Both failed the same way:
  // the sync was perfect and the bar was invisible. macOS hides
  // overlay scrollbars at rest, Chrome ignores ::-webkit-scrollbar
  // entirely once scrollbar-width is set, and neither renders in a
  // headless screenshot, so it could not even be checked.
  //
  // An affordance that cannot be seen is the same as no affordance,
  // and one that cannot be verified is worse. This is a div whose
  // width and offset are arithmetic on the grid's own scroll, which
  // renders identically everywhere and can be dragged in a test.
  useEffect(() => {
    const grid = scrollRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!grid || !track || !thumb) return;

    const paint = () => {
      const visible = grid.clientWidth / grid.scrollWidth;
      // Nothing to scroll: no bar, rather than a full-width thumb
      // that does nothing when you pull it.
      const row = scrollbarRowRef.current;
      const nothingToScroll = visible >= 1;
      if (row) row.hidden = nothingToScroll;
      track.hidden = nothingToScroll;
      if (nothingToScroll) return;
      const trackW = track.clientWidth;
      const thumbW = Math.max(48, Math.round(trackW * visible));
      const maxScroll = grid.scrollWidth - grid.clientWidth;
      const maxLeft = trackW - thumbW;
      const left =
        maxScroll > 0 ? Math.round((grid.scrollLeft / maxScroll) * maxLeft) : 0;
      thumb.style.width = `${thumbW}px`;
      thumb.style.transform = `translateX(${left}px)`;
      thumb.setAttribute("aria-valuenow", String(Math.round(grid.scrollLeft)));
      thumb.setAttribute("aria-valuemax", String(Math.round(maxScroll)));
    };

    paint();
    grid.addEventListener("scroll", paint, { passive: true });
    const observer = new ResizeObserver(paint);
    observer.observe(grid);
    observer.observe(track);
    return () => {
      grid.removeEventListener("scroll", paint);
      observer.disconnect();
    };
  }, [columns, authoring, data]);

  // Dragging it, and clicking the track to jump.
  useEffect(() => {
    const grid = scrollRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!grid || !track || !thumb) return;

    let startX = 0;
    let startScroll = 0;
    let dragging = false;

    function onDown(event: PointerEvent) {
      dragging = true;
      startX = event.clientX;
      startScroll = grid!.scrollLeft;
      thumb!.setPointerCapture(event.pointerId);
      // Or the pointer selects the table text behind it mid-drag.
      event.preventDefault();
    }

    function onMove(event: PointerEvent) {
      if (!dragging) return;
      const maxLeft = track!.clientWidth - thumb!.offsetWidth;
      const maxScroll = grid!.scrollWidth - grid!.clientWidth;
      if (maxLeft <= 0) return;
      // Pixels of thumb travel map onto pixels of content travel,
      // which is what makes a short drag move a wide table.
      grid!.scrollLeft =
        startScroll + ((event.clientX - startX) / maxLeft) * maxScroll;
    }

    function onUp() {
      dragging = false;
    }

    function onTrackClick(event: MouseEvent) {
      if (event.target === thumb) return;
      const box = track!.getBoundingClientRect();
      const ratio = (event.clientX - box.left) / box.width;
      grid!.scrollLeft = ratio * (grid!.scrollWidth - grid!.clientWidth);
    }

    thumb.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    track.addEventListener("click", onTrackClick);
    return () => {
      thumb.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      track.removeEventListener("click", onTrackClick);
    };
  }, []);

  // Measure the pinned offsets, size the open month to the track,
  // then scroll to the end. In that order, and all in one frame,
  // because each step depends on the layout the one before it
  // settles.
  //
  // Re-runs whenever the rows or the open months change, which
  // includes the router.refresh() after a measure is added.
  //
  // ---- IT RESETS BEFORE IT MEASURES ---------------------------
  //
  // Running a second time, after adding a critical success factor,
  // tore the table apart: the pinned block marched off to the right
  // leaving a white gap where the names had been, and every collapsed
  // month vanished.
  //
  // Two faults, both from measuring a table this effect had already
  // changed, and both pushing the same way, which is why a single
  // extra pass was enough to wreck it.
  //
  //   The inline `left` values from the previous run were still on
  //   the cells, so reading a cell's position returned the ADJUSTED
  //   position and the new offset came out as the old one plus
  //   itself.
  //
  //   And the grid was scrolled to the end by then, so the sticky
  //   cells were STUCK: their box was where the scroll had pinned
  //   them rather than where the layout puts them.
  //
  // So every run starts from nothing: clear what the last one wrote,
  // put the scroll back to zero, and only then look.
  //
  // IN A FRAME. Measuring synchronously reads a table the stylesheet
  // has not finished sizing, which is what made the first attempts at
  // this chase a gap that was never about column width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      const table = el.querySelector("table");
      if (!table) return;

      // 0a. REMEMBER WHERE THE READER IS, by month rather than by
      //     pixel. Opening a month inserts four or five columns to
      //     the left of wherever they are looking, so restoring a raw
      //     scrollLeft would slide the table under them. Anchoring on
      //     the leftmost month still on screen keeps the thing they
      //     clicked where they clicked it.
      const anchor = (() => {
        if (!openedRef.current) return null;
        const box0 = el.getBoundingClientRect();
        const lastPinned = el.querySelector<HTMLElement>("[data-last-pinned]");
        const edge = lastPinned
          ? lastPinned.getBoundingClientRect().right
          : box0.left;
        for (const head of Array.from(
          el.querySelectorAll<HTMLElement>("thead [data-month-key]")
        )) {
          const r = head.getBoundingClientRect();
          if (r.right > edge + 1) {
            return { key: head.dataset.monthKey!, offset: r.left - edge };
          }
        }
        return null;
      })();

      // 0b. Back to a clean slate. Reading scrollLeft after setting it
      //     forces the reflow, so what follows sees the unstuck
      //     layout rather than the one that was on screen.
      const pinnedCells = Array.from(
        el.querySelectorAll<HTMLElement>("[data-pin]")
      );
      for (const cell of pinnedCells) cell.style.left = "";
      const weekCols = Array.from(
        el.querySelectorAll<HTMLElement>("col[data-week-col]")
      );
      for (const col of weekCols) col.style.width = "";
      el.scrollLeft = 0;
      void el.scrollLeft;

      const tableLeft = table.getBoundingClientRect().left;

      // 1a. IS THERE ROOM TO PIN AT ALL?
      //
      //     The pinned block is about 770px. On a phone that is two
      //     and a half screens: sticking it leaves no room for a
      //     single week beside it, and insetting the scrollbar by it
      //     pushed a button to x=828 on a 393px viewport, which made
      //     the whole PAGE scroll sideways. That is what was wrong on
      //     mobile, and it took the hero and the drawer with it.
      //
      //     So below a threshold nothing is pinned and the table
      //     scrolls as one piece, which is what a phone wants anyway.
      const roomToPin = el.clientWidth - 160;

      // 1b. Where each pinned column actually starts. Measured rather
      //    than summed from the declared widths: cell borders sit
      //    outside the width a colgroup gives a column, so a running
      //    sum is not where the next one begins and the block drifted
      //    as the weeks scrolled under it.
      let pinnedRight = 0;
      for (const col of pinnedColumns(authoring)) {
        const head = el.querySelector<HTMLElement>(
          `thead [data-pin="${col.key}"]`
        );
        if (!head) continue;
        const box = head.getBoundingClientRect();
        const left = Math.round(box.left - tableLeft);
        pinnedRight = Math.round(box.right - tableLeft);
        if (pinnedRight > roomToPin) break;
        for (const cell of pinnedCells) {
          if (cell.dataset.pin === col.key) cell.style.left = `${left}px`;
        }
      }
      // Nothing was pinned, so nothing is to the left of the weeks.
      const pinning = pinnedRight <= roomToPin;
      el.dataset.pinned = pinning ? "true" : "false";
      if (!pinning) pinnedRight = 0;

      // 2. Share the whole track beside the pinned block among the
      //    open month's weeks.
      //
      //    NOT minus the collapsed months. They are the thing being
      //    scrolled out of sight, so counting them against the track
      //    makes the open month narrower by exactly the width it
      //    needed to push them off, and they stay on screen.
      if (weekCols.length > 0) {
        const track = el.clientWidth - pinnedRight;
        const width = Math.max(
          MIN_WEEK_WIDTH,
          Math.floor(track / weekCols.length)
        );
        for (const col of weekCols) col.style.width = `${width}px`;
      }

      // 3. The scrollbar track begins where the weeks do, so it sits
      //    over the only part of the table that actually moves.
      const row = scrollbarRowRef.current;
      if (row) row.style.marginLeft = `${pinnedRight}px`;

      // 4. Where to leave it.
      //
      //    FIRST TIME: the end, which is this week, with every
      //    earlier month off the left edge.
      //
      //    EXCEPT WITH NOTHING PINNED, which is the phone. The names
      //    scroll away with everything else there, so opening at the
      //    end opens on a column of numbers with no row labels beside
      //    them. Start at the names instead and let the reader swipe
      //    to the week; the other way round there is nothing on
      //    screen to say what is being read.
      //
      //    EVERY TIME AFTER: back where the reader was. Opening a
      //    month used to throw them to the current week and closing
      //    one did it again, so exploring the history fought back.
      requestAnimationFrame(() => {
        if (!openedRef.current || !anchor) {
          el.scrollLeft = pinning ? el.scrollWidth : 0;
          openedRef.current = true;
          return;
        }
        const head = el.querySelector<HTMLElement>(
          `thead [data-month-key="${anchor.key}"]`
        );
        if (!head) {
          el.scrollLeft = el.scrollWidth;
          return;
        }
        const box1 = el.getBoundingClientRect();
        const lastPinned = el.querySelector<HTMLElement>("[data-last-pinned]");
        const edge = lastPinned
          ? lastPinned.getBoundingClientRect().right
          : box1.left;
        el.scrollLeft +=
          head.getBoundingClientRect().left - edge - anchor.offset;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [columns, authoring, data]);

  // NOTHING LOGGED YET IS NOT NOTHING TO SHOW — not to somebody who
  // can add the first one.
  //
  // This returned null whenever no measure existed, which on a
  // company with functions and no measures rendered a page that was
  // a hero and then blank space. The page's own branches cover the
  // reader: no functions gets an empty state, and a non-admin with no
  // measures gets a line explaining where they live. The person the
  // guard actually caught was the ADMIN — the only one who could fix
  // it — and it handed them a blank screen with no Add button on it.
  //
  // Found on the PromiseOne instance, where all thirteen companies
  // have functions and no measures at all.
  if (!data.hasRows && !authoring) return null;

  return (
    <div className={styles.gridStack}>
      {reorderError ? (
        <p role="alert" className={styles.reorderError}>
          {reorderError}
        </p>
      ) : null}

      {/* ONE TOOLBAR, whichever half of it has anything in it.
 
          Both halves used to be gated on Success Tracking as well,
          which meant a company without the flag got a table it could
          read and never type into. The flag says whether the Saturday
          sweep chases you, not whether you may record a number, so
          what shows here is only ever about what this caller may
          write. */}
      {writableRows.length > 0 || addableGroups.length > 0 ? (
        <div className={styles.gridToolbar}>
          {writableRows.length > 0 ? (
            <p
              className={
                outstanding === 0 ? styles.outstandingDone : styles.outstanding
              }
            >
              {outstanding === 0
                ? `All ${writableRows.length} logged for the week beginning ${formatWeekBeginning(chasedWeek)}.`
                : `${outstanding} of ${writableRows.length} still to log for the week beginning ${formatWeekBeginning(chasedWeek)}.`}
            </p>
          ) : !data.hasRows ? (
            // The card still has to read as a card. With no measures
            // there is no count to show, so the title takes the slot
            // the count normally occupies and the Add button keeps
            // its place beside it.
            <h2 className={styles.gridEmptyTitle}>
              Critical Success Factors
            </h2>
          ) : (
            // Holds the left half of the row so the actions stay
            // right, rather than sliding across when there is nothing
            // to count.
            <span />
          )}
          <div className={styles.gridToolbarActions}>
            {writableRows.length > 0 ? (
              <button
                type="button"
                className={uiStyles.btnPrimary}
                onClick={save}
                disabled={pending}
              >
                {pending ? "Saving…" : "Save"}
              </button>
            ) : null}
            {addableGroups.length > 0 ? (
              <button
                type="button"
                className={uiStyles.btnSecondary}
                onClick={() => setAdding(addableGroups[0].functionId)}
              >
                <PlusIcon />Add a critical success factor
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {message ? (
        <p className={message.ok ? styles.successMessage : styles.errorMessage}>
          {message.text}
        </p>
      ) : null}

      {/* THE SCROLLBAR, LIFTED OUT OF THE TABLE.
 
          The native one spans the whole container, including the
          pinned columns, which says the names scroll and they do not.
          It also sits below a table that can be twenty rows tall, so
          reaching it means scrolling the page first.
 
          This is the same scroll, proxied: an empty strip as wide as
          the table's content, inset to start where the weeks do,
          synced both ways. The container's own bar is hidden in CSS.
 
          `syncing` is a plain ref rather than state: each element's
          scroll handler sets the other's scrollLeft, which fires that
          one's handler, and without the flag the two chase each other
          for a frame. */}
      {/* Arrows on both ends, so the bar reads as a control rather
          than as a decorative rule. They page by roughly a month of
          columns, which is the unit this grid is organised in. */}
      {data.hasRows ? (
        <>
        <div className={styles.gridScrollbarRow} ref={scrollbarRowRef}>
          <button
            type="button"
            className={styles.gridScrollArrow}
            onClick={() => nudge(-1)}
            aria-label="Scroll the weeks left"
            tabIndex={-1}
          >
            <ChevronIcon direction="left" />
          </button>
          <div className={styles.gridScrollbar} ref={trackRef}>
            <div
              className={styles.gridScrollbarThumb}
              ref={thumbRef}
              role="scrollbar"
              aria-controls="measures-grid-scroll"
              aria-orientation="horizontal"
              aria-label="Scroll the weeks"
            />
          </div>
          <button
            type="button"
            className={styles.gridScrollArrow}
            onClick={() => nudge(1)}
            aria-label="Scroll the weeks right"
            tabIndex={-1}
          >
            <ChevronIcon direction="right" />
          </button>
        </div>

        <div className={styles.gridScroll} id="measures-grid-scroll" ref={scrollRef}>
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragEnd={handleDragEnd}
          >
          <SortableContext items={areaIds} strategy={verticalListSortingStrategy}>
          <table className={styles.grid}>
            {/* `table-layout: fixed` honours these exactly, which is
                what makes the sticky offsets above correct. Week
                columns carry no width here: the effect sizes them to
                fill the track so the open month lands flush against the
                pinned block. */}
            <colgroup>
              {pinnedColumns(authoring).map((c) => (
                <col key={c.key} style={{ width: c.width }} />
              ))}
              {columns.map((col) => (
                <col
                  key={`${col.kind}-${col.key}`}
                  data-week-col={col.kind === "week" ? "" : undefined}
                  style={
                    col.kind === "month"
                      ? { width: CLOSED_MONTH_WIDTH }
                      : undefined
                  }
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                {/* rowSpan, so the week-label row below carries only
                    week labels. Repeating these as empty cells left a
                    tall blank band across the top of the table. */}
                <th
                  scope="col"
                  rowSpan={2}
                  className={`${styles.gridPin} ${styles.gridPinArea}`}
                        data-pin="area"
                >
                  Functional Area
                </th>
                <th
                  scope="col"
                  rowSpan={2}
                  className={`${styles.gridPin} ${styles.gridPinOwner}`}
                        data-pin="owner"
                >
                  Owner
                </th>
                {authoring ? (
                  <>
                    <th
                      scope="col"
                      rowSpan={2}
                      className={`${styles.gridPin} ${styles.gridPinDrag}`}
                      data-pin="drag"
                    >
                      <span className={styles.visuallyHidden}>Reorder</span>
                    </th>
                    <th
                      scope="col"
                      rowSpan={2}
                      className={`${styles.gridPin} ${styles.gridPinActions}`}
                      data-pin="actions"
                    >
                      <span className={styles.visuallyHidden}>Actions</span>
                    </th>
                  </>
                ) : null}
                <th
                  scope="col"
                  rowSpan={2}
                  className={`${styles.gridPin} ${styles.gridPinName}`}
                        data-pin="name"
                >
                  Critical Success Factor
                </th>
                <th
                  scope="col"
                  rowSpan={2}
                  className={`${styles.gridPin} ${styles.gridPinFreq}`}
                        data-pin="freq"
                >
                  Frequency
                </th>
                <th
                  scope="col"
                  rowSpan={2}
                  className={`${styles.gridPin} ${styles.gridPinTarget}`}
                        data-pin="target"
                  data-last-pinned=""
                >
                  Target
                </th>
                {visibleMonths.map((m) =>
                  openMonths.has(m.key) ? (
                    <th
                      key={m.key}
                      scope="colgroup"
                      colSpan={m.weeks.length}
                      className={styles.gridMonthOpen}
                      data-current-month={m.isCurrent ? "" : undefined}
                      data-month-key={m.key}
                    >
                      <button
                        type="button"
                        className={styles.gridMonthButton}
                        onClick={() => toggleMonth(m.key)}
                        aria-expanded
                      >
                        <span aria-hidden>▾</span> {m.label}
                      </button>
                    </th>
                  ) : (
                    <th
                      key={m.key}
                      scope="col"
                      rowSpan={2}
                      className={styles.gridMonthClosed}
                      data-current-month={m.isCurrent ? "" : undefined}
                      data-month-key={m.key}
                    >
                      <button
                        type="button"
                        className={styles.gridMonthButton}
                        onClick={() => toggleMonth(m.key)}
                        aria-expanded={false}
                      >
                        <span aria-hidden>▸</span> {m.label}
                      </button>
                    </th>
                  )
                )}
              </tr>
              <tr>
                {visibleMonths
                  .filter((m) => openMonths.has(m.key))
                  .flatMap((m) =>
                    m.weeks.map((w) => (
                      <th
                        key={w}
                        scope="col"
                        className={
                          w === weekEnding
                            ? `${styles.gridWeekHead} ${styles.gridWeekHeadCurrent}`
                            : openWeeks.includes(w)
                              ? `${styles.gridWeekHead} ${styles.gridWeekHeadOpen}`
                              : styles.gridWeekHead
                        }
                        title={
                          openWeeks.includes(w) && w !== weekEnding
                            ? "Still open: closes when the next week does"
                            : undefined
                        }
                      >
                        {/* The MONDAY's day of the month. The column is
                            still keyed by the Friday underneath — that is
                            what every value is stored against — but a
                            week is read by the day it starts on. */}
                        {mondayOf(w).slice(8)}
                      </th>
                    ))
                  )}
              </tr>
            </thead>
            {/* One SortableContext per level. The group one lists every
                rendered area; the sibling rule is enforced on drop
                rather than by splitting this into a context per parent,
                because dnd-kit will not drag between contexts at all
                and the useful half of the gesture — seeing the row lift
                and follow the pointer — should still happen when
                somebody tries. */}
            {groupOrder
              .filter((g) => g.rows.length > 0)
              .map((group) => {
              const rows = rowOrder(group);
              return (
                <SortableGroupBody
                  key={group.functionId}
                  id={group.functionId}
                  enabled={areaIds.length > 1 && siblingIds(group).length > 1}
                  rowIds={rows.map((r) => r.id)}
                  onKeyDown={(e) => handleAreaKeyDown(e, group.functionId)}
                >
                  {rows.map((row, i) => (
                    <SortableMeasureRow
                      key={row.id}
                      id={row.id}
                      enabled={authoring && group.canLog && rows.length > 1}
                      first={i === 0}
                      label={row.description}
                      showDragCell={authoring}
                      lead={
                        i === 0 ? (
                          <>
                          {/* Written once per group, spanning its rows, the
                              way the merged Owner and Functional Area cells
                              in the spreadsheet already read. */}
                          {i === 0 ? (
                            <>
                              <th
                                scope="rowgroup"
                                rowSpan={group.rows.length}
                                className={`${styles.gridPin} ${styles.gridPinArea} ${styles.gridAreaCell}`}
                            data-pin="area"
                              >
                                <span className={styles.areaCellInner}>
                                  <AreaDragHandle title={group.functionTitle} />
                                  <Link
                                    href={`/chart/function/${group.functionId}`}
                                    className={styles.fnTitleLink}
                                  >
                                    {group.functionTitle}
                                  </Link>
                                </span>
                              </th>
                              <td
                                rowSpan={group.rows.length}
                                className={`${styles.gridPin} ${styles.gridPinOwner} ${styles.gridOwnerCell}`}
                            data-pin="owner"
                              >
                                {group.ownerName ?? (
                                  <span className={styles.gridNoOwner}>No Lead</span>
                                )}
                              </td>
                            </>
                          ) : null}
                          </>
                        ) : null
                      }
                    >
                        {authoring ? (
                          <td
                            className={`${styles.gridPin} ${styles.gridPinActions} ${styles.gridActionsCell}`}
                          data-pin="actions"
                          >
                            {group.canLog ? (
                              <>
                                <button
                                  type="button"
                                  className={styles.gridIconButton}
                                  onClick={() => setEditing(row.id)}
                                  aria-label={`Edit ${row.description}`}
                                  title="Edit"
                                >
                                  <PencilIcon />
                                </button>
                                <ArchiveMeasureButton measureId={row.id} />
                              </>
                            ) : null}
                          </td>
                        ) : null}
                        <th
                          scope="row"
                          className={`${styles.gridPin} ${styles.gridPinName} ${styles.gridNameCell}`}
                          data-pin="name"
                        >
                          {row.description}
                          <ExternalMeasureNote measureId={row.id} />
                        </th>
                        <td className={`${styles.gridPin} ${styles.gridPinFreq} ${styles.gridFreqCell}`}
                          data-pin="freq">
                          {row.frequencyLabel}
                        </td>
                        <td className={`${styles.gridPin} ${styles.gridPinTarget} ${styles.gridTargetCell}`}
                          data-pin="target">
                          {row.target ? (
                            <>
                              {/* NO ≥ ON A YES/NO MEASURE. "≥ Yes" is
                                  not a comparison anybody makes, and
                                  the direction it came from is not
                                  asked for on a text measure either.
                                  A target of "Yes" stands alone. */}
                              {row.valueType === "text" ? null : (
                                <>
                                  <span className={styles.gridDir} aria-hidden>
                                    {row.direction === "higher_is_better"
                                      ? "≥"
                                      : "≤"}
                                  </span>{" "}
                                </>
                              )}
                              {formatMeasureValue(
                                row.valueType,
                                row.scale,
                                { number: parseTypedNumber(row.target), text: row.target },
                                row.target
                              )}
                            </>
                          ) : (
                            <span className={styles.gridNoTarget}>Not set</span>
                          )}
                        </td>
                        {cellUnits(row, columns).map((col) =>
                          col.kind === "month" ? (
                            <td
                              key={`${row.id}-${col.key}`}
                              className={styles.gridClosedCell}
                            />
                          ) : (
                            <GridCellView
                              key={`${row.id}-${col.key}`}
                              row={row}
                              week={col.key}
                              span={col.span}
                              isCurrent={col.key === weekEnding}
                              editable={cellEditable(row, col.key)}
                              canLog={group.canLog}
                              storageWeek={storageWeek(row, col.key)}
                              value={
                                values[
                                  cellKey(row.id, storageWeek(row, col.key))
                                ] ?? ""
                              }
                              onChange={(v) =>
                                setValues((prev) => ({
                                  ...prev,
                                  [cellKey(row.id, storageWeek(row, col.key))]: v,
                                }))
                              }
                              disabled={pending}
                            />
                          )
                        )}
                    </SortableMeasureRow>
                  ))}
                  </SortableGroupBody>
                );
              })}
          </table>
          </SortableContext>
          </DndContext>
        </div>
        </>
      ) : (
        <p className={styles.gridEmptyLine}>
          No Critical Success Factors have been created yet.
        </p>
      )}

      {editingRow || adding ? (
        <Drawer
          open
          onClose={() => {
            setEditing(null);
            setAdding(null);
          }}
          eyebrow="Critical success factor"
          title={editingRow ? editingRow.description : "Add a new one"}
        >
          <EditMeasureForm
            key={editingRow ? editingRow.id : `new-${adding}`}
            measure={
              editingRow
                ? {
                    id: editingRow.id,
                    description: editingRow.description,
                    target: editingRow.target,
                    value_type: editingRow.valueType,
                    value_scale: editingRow.scale,
                    target_direction: editingRow.direction,
                    update_frequency: editingRow.frequency,
                    show_on_dashboard: editingRow.showOnDashboard,
                  }
                : BLANK_MEASURE
            }
            outcomeTitle={editingRow?.description ?? ""}
            outcomeDescription={editingRow?.detail ?? null}
            onDone={() => {
              setEditing(null);
              setAdding(null);
            }}
            onCreated={(id) => {
              // Stay open on the row that was just created, so
              // the external source fields below are live against
              // it. Nothing about them is required: close the
              // drawer and the measure is already saved.
              setAdding(null);
              setEditing(id);
            }}
            createIn={editingRow ? undefined : adding ?? undefined}
            functionChoices={addableGroups.map((g) => ({
              id: g.functionId,
              title: g.functionTitle,
            }))}
            onFunctionChange={setAdding}
          />

          {/* CONNECTING A MEASURE TO A SPREADSHEET, back where it
              can be reached.
 
              It used to live in the row's settings strip, and
              deleting ManagedMeasureRow for the grid took it with
              it: the import survived in this form and nothing
              rendered it, so for several commits a company with
              external_measures on had no way to map a measure at
              all. Same shape as the add control disappearing.
 
              Edit only. A mapping needs a measure to hang off,
              and there is no id until the row exists.
 
              It gates itself on the flag through the provider
              this drawer already sits inside, so nothing here
              needs to know whether the company has it. */}
          {editingRow ? (
            <ExternalSourceControls
              measureId={editingRow.id}
              // The owning function's own answer. `canLog` already
              // means "an admin of this company, an assigned
              // guide, or this function's Lead", which is exactly
              // who RLS admits to the measure.
              canAdminister={
                data.groups.find((g) =>
                  g.rows.some((r) => r.id === editingRow.id)
                )?.canLog ?? false
              }
            />
          ) : (
            <p className={styles.drawerHint}>
              Connecting this to a spreadsheet becomes available as
              soon as you add it.
            </p>
          )}
        </Drawer>
      ) : null}
    </div>
  );
}

// WHAT A ROW ACTUALLY DRAWS, which is not always one cell per column.
//
// A weekly measure draws the columns as they are. A MONTHLY one
// collapses each run of week columns belonging to one month into a
// single cell that spans them, because a monthly measure has one
// number for the month and four boxes showing it would read as four
// values that happen to match.
//
// It also solves a problem the per-week version could not. A monthly
// value lands on the last week beginning in its month — September's
// ends 2 October — which is a week the grid has not drawn yet. A cell
// addressed by MONTH does not care: it spans whatever columns of its
// month are on screen and writes to the month's own week either way,
// so no future column has to appear on the page.
//
// A collapsed month is already one column, so its run is length 1 and
// this changes nothing there.
type CellUnit =
  | { kind: "month"; key: string; span: 1 }
  | { kind: "week"; key: string; span: number };

function cellUnits(
  row: GridRow,
  // Structural rather than the component's local Column type, which
  // is declared inside it and not in scope out here.
  columns: ReadonlyArray<{ kind: "month" | "week"; key: string }>
): CellUnit[] {
  if (row.frequency !== "monthly") {
    return columns.map((c) =>
      c.kind === "month"
        ? { kind: "month", key: c.key, span: 1 }
        : { kind: "week", key: c.key, span: 1 }
    );
  }
  const out: CellUnit[] = [];
  for (const col of columns) {
    if (col.kind === "month") {
      out.push({ kind: "month", key: col.key, span: 1 });
      continue;
    }
    const last = out[out.length - 1];
    if (
      last &&
      last.kind === "week" &&
      monthKeyOf(last.key) === monthKeyOf(col.key)
    ) {
      last.span += 1;
      continue;
    }
    out.push({ kind: "week", key: col.key, span: 1 });
  }
  return out;
}

function GridCellView({
  row,
  week,
  span,
  storageWeek,
  isCurrent,
  editable,
  canLog,
  value,
  onChange,
  disabled,
}: {
  row: GridRow;
  week: string;
  // How many week columns this cell covers. Always 1 except on a
  // monthly measure, where one cell spans its month.
  span: number;
  // WHERE THIS CELL'S VALUE ACTUALLY LIVES. The same week for a
  // weekly measure. For a monthly one it is the month's own week, so
  // every box across the month reads and writes one number — which is
  // also why they all show the same figure and the same status.
  storageWeek: string;
  isCurrent: boolean;
  // Whether this cell still accepts a value. For a monthly measure
  // that is true across its whole month, not only on the week the
  // value lands in.
  editable: boolean;
  canLog: boolean;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const cell = row.cells.find((c) => c.weekEnding === storageWeek);
  // A monthly measure is ONE cell across its month, so the block is
  // said by the cell itself rather than by bracketing four of them.
  // NO LABEL — the Frequency column already says "Monthly", and there
  // is no room for words in a cell that is mostly input.
  const monthly = row.frequency === "monthly";
  // NO LONGER DRAWN. This used to put a 2px amber rule down the left
  // edge of the cell where a new target took effect. It read as an
  // alert about the number rather than a note about the yardstick,
  // and it drew the eye to the one thing on the row that was not a
  // value. Removed at Jason's request, 2026-09-19.
  //
  // The change is still KNOWN, and still explains itself on hover —
  // "Target changed from 98% to 0" — which is the honest half of what
  // this was for. A cell going from green to red because the target
  // moved, with nothing anywhere saying so, is the thing worth
  // avoiding; a coloured rule down the table was not the way.
  const change = row.targetChanges.get(storageWeek);

  // Not expected: render nothing at all. Not a dash, not a zero, not
  // a muted dot. A monthly row is blank three weeks in four and any
  // mark in those cells reads as a week somebody skipped.
  if (!cell || !cell.expected) {
    return (
      <td className={styles.gridNotDue} colSpan={span} aria-hidden />
    );
  }

  const className = [
    styles.gridCell,
    styles[`gridCell_${cell.status}`],
    isCurrent ? styles.gridCellCurrent : "",
    // The just-closed week reads as open too, more quietly than this
    // week: it is the one with a deadline, not the one you are
    // filling in as you go.
    editable && !isCurrent ? styles.gridCellOpen : "",
    monthly ? styles.gridMonthBlock : "",
  ]
    .filter(Boolean)
    .join(" ");

  const title = change
    ? `Target changed from ${change.from ?? "none"} to ${change.to ?? "none"}`
    : cell.target
      ? `Target ${cell.target} this week`
      : undefined;

  if (editable && canLog) {
    return (
      <td className={className} colSpan={span} title={title}>
        <input
          className={styles.gridInput}
          type={row.valueType === "text" ? "text" : "number"}
          inputMode={row.valueType === "text" ? undefined : "decimal"}
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={
            monthly
              ? `${row.description}, ${monthLabel(monthKeyOf(storageWeek))}`
              : `${row.description}, week beginning ${mondayOf(week)}`
          }
        />
      </td>
    );
  }

  return (
    <td className={className} colSpan={span} title={title}>
      {cell.displayValue || <span className={styles.gridEmpty} aria-hidden />}
    </td>
  );
}

function cellKey(measureId: string, week: string): string {
  return `${measureId}|${week}`;
}

function isDueInWeek(row: GridRow, week: string): boolean {
  return row.cells.find((c) => c.weekEnding === week)?.expected ?? false;
}

// What goes IN the input box, which is the measure's own unit rather
// than what is stored. A millions measure holding 18000000 shows 18,
// because 18 is what somebody typed and what they expect to find.
function valueAt(row: GridRow, week: string): string {
  const cell = row.cells.find((c) => c.weekEnding === week);
  if (!cell?.value) return "";
  if (row.valueType === "text") return cell.value.text ?? "";
  if (cell.value.number == null || !Number.isFinite(cell.value.number)) return "";
  return String(toEntryNumber(cell.value.number, row.valueType, row.scale));
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  // Same geometry as PlusIcon and the row actions: a 16 viewbox drawn
  // at 14px, 1.4 stroke, round caps. Anything else reads as a second
  // icon set at the same size.
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden focusable="false">
      <path
        d={direction === "left" ? "M10 3.5 L5.5 8 L10 12.5" : "M6 3.5 L10.5 8 L6 12.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---- The two sortable shells ------------------------------------
//
// A <tbody> per functional area, and a sortable <tr> inside it. The
// grouping is what makes an AREA draggable at all: an area is a run
// of rows, and a run of rows is only a DOM node if it has its own
// tbody. A table may carry as many as it likes.
//
// THE AREA HANDLE LIVES IN THE AREA CELL, which the parent renders
// as `lead`, so its drag props have to reach across. A context is
// the cheapest way that does not turn every cell into a render prop.
const GroupDragContext = createContext<{
  enabled: boolean;
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown>;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}>({ enabled: false, attributes: {}, listeners: {}, onKeyDown: () => {} });

export function AreaDragHandle({ title }: { title: string }) {
  const { enabled, attributes, listeners, onKeyDown } =
    useContext(GroupDragContext);
  if (!enabled) return null;
  return (
    <button
      type="button"
      className={styles.areaDragHandle}
      aria-label={`Reorder ${title}`}
      title="Drag to reorder this functional area, or use the arrow keys"
      {...attributes}
      {...listeners}
      // AFTER the spread, deliberately: dnd-kit's own onKeyDown is
      // what starts a pointer-style drag, and it ignores the arrows
      // unless one is already running. Ours moves the area outright,
      // which is the only keyboard path that works here.
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true">⠿</span>
    </button>
  );
}

function SortableGroupBody({
  id,
  enabled,
  rowIds,
  onKeyDown,
  children,
}: {
  id: string;
  enabled: boolean;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  // The measures in this area, as their own sortable context.
  //
  // NOT OPTIONAL, and not merely tidy. Without it the rows register
  // in the DndContext with no container of their own, and the
  // keyboard sensor cannot tell the two levels apart: picking up an
  // AREA and pressing Down reported "moved over" the area it started
  // on, every time, because sortableKeyboardCoordinates was choosing
  // among droppables belonging to both levels at once. Six areas,
  // six handles, and not one of them moved.
  rowIds: string[];
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !enabled });

  return (
    <GroupDragContext.Provider
      value={{
        enabled,
        attributes: attributes as unknown as Record<string, unknown>,
        listeners: (listeners ?? {}) as unknown as Record<string, unknown>,
        onKeyDown,
      }}
    >
      <tbody
        ref={setNodeRef}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          // Not `opacity: 0`: the row has to stay legible while it
          // moves, because what you are aiming at is the area name.
          opacity: isDragging ? 0.6 : 1,
        }}
        data-dragging={isDragging ? "true" : undefined}
      >
        <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
      </tbody>
    </GroupDragContext.Provider>
  );
}

function SortableMeasureRow({
  id,
  enabled,
  first,
  label,
  showDragCell,
  lead,
  children,
}: {
  id: string;
  enabled: boolean;
  first: boolean;
  label: string;
  // Whether the column exists at all. It travels with the authoring
  // columns, so a reader is not given 36px of permanently empty
  // table — but a cell still has to be emitted for every row when it
  // does exist, or the row runs a column short and every cell after
  // it slides one place left.
  showDragCell: boolean;
  lead: ReactNode;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !enabled });

  return (
    <tr
      ref={setNodeRef}
      className={first ? styles.gridGroupStart : undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      data-dragging={isDragging ? "true" : undefined}
    >
      {lead}
      {showDragCell ? (
        <td
          className={`${styles.gridPin} ${styles.gridPinDrag} ${styles.gridDragCell}`}
          data-pin="drag"
        >
          {enabled ? (
            <button
              type="button"
              className={styles.rowDragHandle}
              aria-label={`Reorder ${label}`}
              title="Drag to reorder"
              {...attributes}
              {...listeners}
            >
              <span aria-hidden="true">⠿</span>
            </button>
          ) : null}
        </td>
      ) : null}
      {children}
    </tr>
  );
}
