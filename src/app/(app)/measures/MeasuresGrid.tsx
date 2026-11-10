"use client";

import {
  createContext,
  memo,
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
import { useRouter } from "next/navigation";
import {
  logMeasureEntriesAction,
  type MeasureEntryInput,
} from "@/lib/measures/actions";
import { storageWeekFor } from "@/lib/measures/frequency";
import { mergeServerValues } from "@/lib/measures/grid-values";
import { summarizeStrip } from "@/lib/measures/grid-strip";
import { anyWeekOpen, isEntryWeekOpen } from "@/lib/measures/entry-window";
import {
  monthKeyOf,
  monthLabel,
  weekLabel,
  weekOfMonth,
  weekStartShort,
} from "@/lib/measures/months";
import type { GridData, GridRow,
  GridGroup,
  GridCell,
} from "@/lib/measures/grid";
import { pullExternalMeasureAction } from "@/lib/external-measures/actions";
import { defaultPullWeek } from "@/lib/external-measures/pull-week";
import { EditMeasureForm, ArchiveMeasureDialog } from "./EditMeasureForm";
import { ExternalMeasureNote } from "./external/ExternalMeasureNote";
import { ExternalSourceControls } from "./external/ExternalSourceControls";
import {
  useExternalMeasure,
  useExternalMeasures,
} from "./external/ExternalMeasuresContext";
import { PlusIcon } from "@/components/ui/PlusIcon";
import { RowMenu, type RowMenuItem } from "@/components/ui/RowMenu";
import {
  formatMeasureValue,
  parseTypedNumber,
  toEntryText,
  toStoredNumber,
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
import { simplifyOn } from "@/lib/ui/simplify";

// The /measures grid.
//
// ---- FUNCTION BANDS (Option B, Jason 2026-11-06) --------------
//
// Each functional area is a band across the table: its drag handle,
// its name, its Lead and how many measures it has. Under it, one row
// per critical success factor, and ONE pinned column: the CSF's name,
// with its frequency, target and data source on a line beneath.
// Then a rolling year of weeks.
//
// It was seven pinned columns (Functional Area, Owner, a drag column,
// an actions column, the name, Frequency, Target), about 770px of a
// card capped near 1160, which left room for a week or two beside
// them. The band carries what Functional Area and Owner said once per
// function anyway; the meta line carries Frequency and Target; the
// row's own hover carries the handle and a menu in place of the
// pencil and bin. About 320px is pinned now, so roughly nine weeks
// are on screen at 1440px and seven at 1280px.
//
// ---- WHY A TABLE AND NOT THE CSS GRID THAT WAS HERE ----------
//
// The page was a CSS grid with `display: contents` rows, which places
// every cell against the parent's tracks. That works when the column
// count is fixed. Here it is not: a month collapses to one column and
// expands to four or five, so the track list changes as you click.
//
// A table does the two things that then matter for free: rows stay
// aligned however many cells a header spans, and the name column
// pins with `position: sticky` while the weeks scroll under it. The
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
// column and the one that just closed both accept a value, and both
// are tinted and labelled ("Last week", "This week") so it is obvious
// where to type.
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

// THE PINNED COLUMN'S WIDTH lives in the stylesheet (.gridColName),
// because it is the one number that changes at phone width (320px,
// 150px under 640px) and a media query can say that where an inline
// width cannot.
//
// ITS STICKY OFFSET IS ZERO, also in the stylesheet. With seven pinned
// columns the offsets had to be MEASURED from the rendered header:
// cell borders sit outside the width a colgroup declares, so a running
// sum of widths drifted by up to thirty pixels. One column has no
// running sum, so `left: 0` is exact by construction.

// A collapsed month is one narrow column.
const CLOSED_MONTH_WIDTH = 44;
// A week column. Narrow, so the history beside the name reads as a
// row of numbers (about nine at 1440px). Room for seven characters
// in the value box ("12345.6", "152.73"), with the box's 7ch minimum
// in measures.module.css: 7ch at 13px is about 55px, plus 10px of box
// padding and border, plus 8px of cell padding, plus a little air.
// When the open weeks are fewer than the track holds, they widen to
// fill it rather than leave a gap after this week.
const WEEK_WIDTH = 86;

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

type Message = { ok: boolean; text: string };

export function MeasuresGrid({
  data,
  weekEnding,
  isAdmin,
}: {
  data: GridData;
  weekEnding: string;
  // Whether this caller works the whole company's numbers
  // (worksTeamIn: admins, assigned guides, switched-on portfolio
  // admins, facilitators). It decides which weeks open for typing
  // (entry-window.ts). Whether a function's controls appear is asked
  // per function through `canLog`, which carries the same answer or
  // the function's own Lead.
  isAdmin: boolean;
}) {
  // Whether this caller can author anywhere: decides whether the row
  // handle keeps its space, so names line up across functions.
  const authoring = isAdmin || data.groups.some((g) => g.canLog);

  // ---- LOOKUPS, BUILT ONCE PER DATA -----------------------------
  //
  // Every cell used to find its week with `row.cells.find(...)`: a
  // linear scan of 53 cells, from each box on screen, from every
  // editable week the server-values map and the save walk (all 52 of
  // them for an admin), several times a cell per render. A map per row
  // makes each of those one lookup, and it is rebuilt only when the
  // server's data changes.
  const cellsByRow = useMemo(() => {
    const out = new Map<string, Map<string, GridCell>>();
    for (const g of data.groups) {
      for (const r of g.rows) {
        out.set(r.id, new Map(r.cells.map((c) => [c.weekEnding, c])));
      }
    }
    return out;
  }, [data.groups]);
  const cellOf = useCallback(
    (row: GridRow, week: string) => cellsByRow.get(row.id)?.get(week),
    [cellsByRow]
  );

  // ---- DRAG TO REORDER ------------------------------------------
  //
  // Two levels, and they are two different permissions.
  //
  //   A FUNCTIONAL AREA moves among its SIBLINGS, by the handle on its
  //   band. This page renders the chart's hierarchy flattened, so a
  //   drag across parents would be a chart edit wearing a grid's
  //   clothes and the next render would undo it. In practice it reads
  //   as a flat reorder: every company on the fleet nests nearly every
  //   function under one parent, so the areas people reorder are
  //   already siblings. It writes through reorderFunctionsAction,
  //   which is admin and guide only: arranging the chart is not a
  //   Lead's call.
  //
  //   A CRITICAL SUCCESS FACTOR moves within its own area, by the
  //   handle beside its name, and that is open to whoever may author
  //   it: admin, guide, facilitator, or the function's Lead. Asked
  //   through `canLog` rather than restated.
  //
  // Both orders are OPTIMISTIC and revert on refusal, and both take
  // the server's order verbatim whenever nothing is in flight:
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
  // no band worth a handle.
  const areaIds = groupOrder.filter((g) => g.rows.length > 0).map((g) => g.functionId);

  // COLLISIONS ARE CONFINED TO THE LEVEL BEING DRAGGED, and this is
  // not a refinement: without it the area drag does nothing at all.
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
  const groupIdSet = useMemo(
    () => new Set(groupOrder.map((g) => g.functionId)),
    [groupOrder]
  );
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
    [groupIdSet]
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
  // pointer drag works (measured, an area moved from first to third),
  // so the gesture is sound and only its keyboard half is not.
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

  // OPEN ON THIS MONTH AND THE ONE BEFORE IT, with the rest folded.
  //
  // A rolling year is 52 columns and nobody needs 52 at once. It was
  // the current month alone, which fit the old pinned block's
  // leftovers exactly. With narrow week columns the track holds about
  // nine, so one month left the track half empty, and early in a
  // month it left LAST week, the one with a deadline, inside a folded
  // column. Two months put both open weeks on screen whatever the
  // date.
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => {
    const current = data.months.findIndex((m) => m.isCurrent);
    return new Set(
      data.months
        .filter((_, i) => current >= 0 && (i === current || i === current - 1))
        .map((m) => m.key)
    );
  });

  // WHETHER A BOX IS OPEN is the shared entry rule (measures/
  // entry-window.ts), the same one the server checks before it writes
  // a value. A monthly measure is open for its whole month, and after
  // month end while its own week is still in the ordinary window; an
  // admin may edit any week on the page; everyone else, this week and
  // the one just closed.
  const cellEditable = (row: GridRow, week: string): boolean =>
    isEntryWeekOpen({ frequency: row.frequency, week, currentWeek: weekEnding, isAdmin });

  // THE WEEKS THAT ARE STILL OPEN, which is not the same question as
  // the weeks this caller may type into.
  //
  // Open means open to everyone: the week that just closed and the
  // current one. That is what the lime tint and the "Last week" and
  // "This week" labels describe, and it is the window the Friday
  // nudge and the Saturday sweep work to. An admin's wider reach gets
  // boxes in other weeks but no tint, so the deadline everyone else
  // works to is never misstated. Oldest first, so the grid reads left
  // to right.
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
  // rather than a keystroke", meaning somebody had to ask an
  // engineer. That is not a rule anybody chose, it is the absence of
  // a control, and the lock was never a boundary anyway: the entry
  // action had no week check at all, so the window was a disabled
  // input and nothing more.
  //
  // The window still exists for everyone else, unless the
  // "past-numbers" switch is on (Jeff and Jason, 2026-10-19): then a
  // Lead may correct an older week too, and what keeps a closed week a
  // record is the change log (0291), shown on the cell, rather than a
  // locked box.
  const wideWindow = anyWeekOpen(isAdmin);
  const editableWeeks = useMemo(
    () => (wideWindow ? data.weeks : openWeeks),
    [wideWindow, data.weeks, openWeeks]
  );

  // THE ROWS THIS CALLER MAY LOG. The strip counts them, the filter
  // narrows to them and the save writes them: one list, so the three
  // cannot disagree about whose numbers are whose.
  const loggableRows = useMemo(
    () => data.groups.filter((g) => g.canLog).flatMap((g) => g.rows),
    [data.groups]
  );

  // What the server holds for every editable box, keyed by measure AND
  // week.
  const serverValues = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        data.groups.flatMap((g) =>
          g.rows.flatMap((r) =>
            // Keyed by where the value LIVES, not by the column it is
            // shown in, so a monthly measure's month is one entry in
            // this map whichever of its weeks it was typed against.
            editableWeeks.map((w) => {
              const own = storageWeekFor(r.frequency, w);
              return [cellKey(r.id, own), valueAt(r, cellOf(r, own))];
            })
          )
        )
      ),
    [data.groups, editableWeeks, cellOf]
  );
  const [values, setValues] = useState<Record<string, string>>(serverValues);
  // FOLLOWS THE SERVER (2026-11-05). The copy above was taken once, so
  // Pull now refreshed the page's data and the box kept showing the
  // old value until a reload. When the server's values change, every
  // box the person has not changed takes the new value; one they have
  // typed in and not saved keeps what they typed (mergeServerValues).
  const lastServerValues = useRef(serverValues);
  useEffect(() => {
    const previous = lastServerValues.current;
    if (previous === serverValues) return;
    lastServerValues.current = serverValues;
    setValues((current) => mergeServerValues(current, previous, serverValues));
  }, [serverValues]);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message | null>(null);
  // Which measure's settings are open in the drawer. One at a time,
  // by construction: it is one drawer.
  const [editing, setEditing] = useState<string | null>(null);
  // Which measure the archive confirmation is asking about, or null.
  // One dialog for the page: the row menu that opens it unmounts the
  // moment Archive is chosen.
  const [archiving, setArchiving] = useState<string | null>(null);
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

  // ---- THE STRIP ------------------------------------------------
  //
  // Last week logged, this week entered, on target last week, and the
  // rows still owed a number (grid-strip.ts, which My week's count
  // asks too). Read from the LIVE boxes, so a number counts the moment
  // it is typed, which is what the line it replaced did.
  const strip = useMemo(
    () =>
      summarizeStrip(loggableRows, {
        lastWeek: data.previousWeekEnding,
        currentWeek: weekEnding,
        hasValue: (r, w) => (values[cellKey(r.id, w)] ?? "").trim() !== "",
      }),
    [loggableRows, data.previousWeekEnding, weekEnding, values]
  );

  // SHOW ONLY WHAT NEEDS A NUMBER, as a SNAPSHOT taken when it is
  // switched on, not a live filter.
  //
  // Live, a row would vanish the moment its box got a character: the
  // input unmounts under the cursor and the rest of the number lands
  // nowhere. Frozen, the rows you were shown stay until you switch the
  // filter off, and the count on the button keeps falling as you go.
  const [needsOnly, setNeedsOnly] = useState<Set<string> | null>(null);
  const toggleNeedsOnly = () =>
    setNeedsOnly((prev) => (prev ? null : new Set(strip.needsNumber)));

  function toggleMonth(key: string) {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // AUTOSAVE under the "autosave" switch (simplification review,
  // change 8): leaving a cell saves, a moment later, whatever changed;
  // the Save button goes. It is the same save, which already sends
  // only the cells that differ from what the server holds, so a blur
  // with nothing new sends nothing and says nothing.
  const autosave = simplifyOn("autosave");
  const saveRef = useRef<(opts?: { quiet?: boolean }) => void>(() => {});
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // STABLE, so a memoized cell is not re-rendered by a new function
  // every keystroke. It reads the latest save through saveRef.
  const scheduleSave = useCallback(() => {
    if (!autosave) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => saveRef.current({ quiet: true }), 300);
  }, [autosave]);
  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
  }, []);
  // One box's new text, keyed by where its value lives. Stable for
  // the same reason as scheduleSave.
  const setValue = useCallback((key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  }, []);

  function save(opts?: { quiet?: boolean }) {
    setMessage(null);
    // ONLY WHAT CHANGED, compared against what the server currently
    // holds rather than against a remembered baseline. `data` is
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
          // DEDUPED ONTO THE STORAGE WEEK. A monthly measure shows one
          // box across its month and every week of it is one value, so
          // without this a save would carry the same row four times.
          Array.from(
            new Set(editableWeeks.map((w) => storageWeekFor(r.frequency, w)))
          )
            .filter((w) => isDueInWeek(cellOf(r, w)))
            .filter((w) => (values[cellKey(r.id, w)] ?? "") !== valueAt(r, cellOf(r, w)))
            .map((w) => ({
              measureId: r.id,
              valueType: r.valueType,
              scale: r.scale,
              rawValue: values[cellKey(r.id, w)] ?? "",
              weekEnding: w,
            }))
        )
      );
    if (opts?.quiet && entries.length === 0) return;
    startTransition(async () => {
      const result = await logMeasureEntriesAction(entries, weekEnding);
      if (result.ok && opts?.quiet) {
        setMessage({ ok: true, text: "Saved." });
      } else if (result.ok) {
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

  saveRef.current = save;

  // Every column the body has to emit, in order, so a row and the
  // header cannot disagree about how many cells there are.
  type Column =
    | { kind: "week"; key: string; month: string }
    | { kind: "month"; key: string; month: string };
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
  //
  // KEPT OVER THE PROTOTYPE'S Earlier / This week / Later buttons.
  // Those page by a fixed step and say nothing about where you are in
  // the year; the thumb does both, its arrows already page by about a
  // month, and it is the part of this page with the most hard-won
  // decisions behind it.
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
    // The table too: a month opening changes the scroll width without
    // resizing the container, which is what this used to re-subscribe
    // on every data change to catch.
    const table = grid.querySelector("table");
    if (table) observer.observe(table);
    return () => {
      grid.removeEventListener("scroll", paint);
      observer.disconnect();
    };
  }, [data.hasRows]);

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
  }, [data.hasRows]);

  // Measure the pinned column, size the open weeks to the track, then
  // scroll. In that order, and all in one frame, because each step
  // depends on the layout the one before it settles.
  //
  // Re-runs whenever the rows or the open months change, which
  // includes the router.refresh() after a measure is added.
  //
  // ---- IT RESETS BEFORE IT MEASURES ---------------------------
  //
  // Running a second time, after adding a critical success factor,
  // once tore the table apart: the pinned block marched off to the
  // right leaving a white gap where the names had been, and every
  // collapsed month vanished. Both faults came from measuring a table
  // this effect had already changed: the widths it wrote last time,
  // and a grid scrolled to the end, whose sticky cells are STUCK where
  // the scroll pinned them rather than where the layout puts them.
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
      const weekCols = Array.from(
        el.querySelectorAll<HTMLElement>("col[data-week-col]")
      );
      for (const col of weekCols) col.style.width = "";
      el.scrollLeft = 0;
      void el.scrollLeft;

      const tableLeft = table.getBoundingClientRect().left;

      // 1a. IS THERE ROOM TO PIN AT ALL? Room, that is, for a week
      //     beside the name. The name column is 150px on a phone,
      //     which leaves a week or two; on anything narrower than
      //     that, pinning leaves nothing beside it, and insetting the
      //     scrollbar by it once pushed a button past the screen's
      //     edge and made the whole PAGE scroll sideways. So below
      //     this nothing is pinned and the table scrolls as one piece.
      const roomToPin = el.clientWidth - 80;

      // 1b. Where the weeks start: the pinned column's right edge,
      //     measured, because borders sit outside a colgroup width.
      const head = el.querySelector<HTMLElement>("thead [data-last-pinned]");
      let pinnedRight = head
        ? Math.round(head.getBoundingClientRect().right - tableLeft)
        : 0;
      const pinning = pinnedRight <= roomToPin;
      el.dataset.pinned = pinning ? "true" : "false";
      if (!pinning) pinnedRight = 0;

      // 1c. ON OPENING, ENOUGH MONTHS TO FILL THE TRACK. Two months
      //     can be six weeks early in a month, and six stretched
      //     across room for eight or nine is the half-empty track the
      //     narrow columns were meant to end. So open earlier months
      //     until the weeks fill it, then come back round: the change
      //     to `columns` re-runs this effect, which sizes and scrolls
      //     the table it now has. First run only; after that which
      //     months are open is the reader's business.
      if (!openedRef.current && pinning) {
        // Rounded UP: a part-shown week at the left edge says there
        // is more to scroll to, where stretched columns say there
        // is not.
        const wanted = Math.ceil((el.clientWidth - pinnedRight) / WEEK_WIDTH);
        const firstOpen = data.months.findIndex(
          (m) => m.key === columns.find((c) => c.kind === "week")?.month
        );
        let count = weekCols.length;
        const earlier: string[] = [];
        for (let i = firstOpen - 1; i >= 0 && count < wanted; i -= 1) {
          earlier.push(data.months[i].key);
          count += data.months[i].weeks.length;
        }
        if (earlier.length > 0) {
          setOpenMonths((prev) => new Set([...prev, ...earlier]));
          return;
        }
      }

      // 2. The open weeks are WEEK_WIDTH each, or wider when there are
      //    fewer of them than the track beside the name can hold, so
      //    this week lands at the right-hand edge rather than short
      //    of it with blank table after.
      //
      //    NOT minus the collapsed months. They are the thing being
      //    scrolled out of sight, so counting them against the track
      //    makes the open weeks narrower by exactly the width they
      //    needed to push them off, and they stay on screen.
      if (weekCols.length > 0) {
        const track = el.clientWidth - pinnedRight;
        const width = Math.max(WEEK_WIDTH, Math.floor(track / weekCols.length));
        for (const col of weekCols) col.style.width = `${width}px`;
      }

      // 3. The scrollbar track begins where the weeks do, so it sits
      //    over the only part of the table that actually moves.
      const row = scrollbarRowRef.current;
      if (row) row.style.marginLeft = `${pinnedRight}px`;

      // 4. Where to leave it.
      //
      //    FIRST TIME: the end, which is this week, with every
      //    earlier folded month off the left edge.
      //
      //    EXCEPT WITH NOTHING PINNED. The names scroll away with
      //    everything else there, so opening at the end opens on a
      //    column of numbers with no row labels beside them. Start at
      //    the names instead and let the reader swipe to the week.
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

  // NOTHING LOGGED YET IS NOT NOTHING TO SHOW, not to somebody who
  // can add the first one.
  //
  // This returned null whenever no measure existed, which on a
  // company with functions and no measures rendered a page that was
  // a hero and then blank space. The page's own branches cover the
  // reader: no functions gets an empty state, and a non-admin with no
  // measures gets a line explaining where they live. The person the
  // guard actually caught was the ADMIN, the only one who could fix
  // it, and it handed them a blank screen with no Add button on it.
  //
  // Found on the PromiseOne instance, where all thirteen companies
  // have functions and no measures at all.
  if (!data.hasRows && !authoring) return null;

  const shownGroups = groupOrder
    .map((group) => {
      const rows = rowOrder(group);
      return {
        group,
        rows: needsOnly ? rows.filter((r) => needsOnly.has(r.id)) : rows,
      };
    })
    // An empty band says nothing, and under the filter a function
    // with nothing owed is exactly what the reader asked to hide.
    .filter((g) => g.rows.length > 0);

  const showStrip = strip.current.due > 0 || (strip.last?.due ?? 0) > 0;

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
      {loggableRows.length > 0 || addableGroups.length > 0 ? (
        <div className={styles.gridToolbar}>
          {showStrip ? (
            <StripView
              strip={strip}
              needsOnly={needsOnly !== null}
              onToggleNeeds={toggleNeedsOnly}
            />
          ) : !data.hasRows ? (
            // The card still has to read as a card. With no measures
            // there is no count to show, so the title takes the slot
            // the strip normally occupies and the Add button keeps
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
            {loggableRows.length > 0 && autosave ? (
              <span className={styles.autosaveStatus} role="status" aria-live="polite">
                {pending ? "Saving…" : "Changes save as you go"}
              </span>
            ) : loggableRows.length > 0 ? (
              <button
                type="button"
                className={uiStyles.btnPrimary}
                onClick={() => save()}
                disabled={pending}
              >
                {pending ? "Saving…" : "Save"}
              </button>
            ) : null}
            {addableGroups.length > 0 ? (
              <button
                type="button"
                className={`${uiStyles.btnSecondary}`}
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
          pinned column, which says the names scroll and they do not.
          It also sits below a table that can be twenty rows tall, so
          reaching it means scrolling the page first. This is the same
          scroll, proxied, inset to start where the weeks do. The
          container's own bar is hidden in CSS.

          Arrows on both ends, so the bar reads as a control rather
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
            {/* `table-layout: fixed` honours these exactly. The name
                column's width is the stylesheet's (.gridColName); the
                weeks start at WEEK_WIDTH and the effect above widens
                them when there is track to spare. */}
            <colgroup>
              <col className={styles.gridColName} />
              {columns.map((col) => (
                <col
                  key={`${col.kind}-${col.key}`}
                  data-week-col={col.kind === "week" ? "" : undefined}
                  style={{
                    width: col.kind === "month" ? CLOSED_MONTH_WIDTH : WEEK_WIDTH,
                  }}
                />
              ))}
            </colgroup>
            {/* A SHORT HEADER THAT STAYS PUT. Two rows, about 78px
                together where the old one was about 170: the months
                with their fold buttons, then each week as "Wk 1" with
                the Monday it starts under it. Both rows are sticky to
                the top of the table's own scroll area, so the weeks
                stay labelled however far down the functions run. */}
            <thead>
              <tr>
                {/* rowSpan, so the week-label row below carries only
                    week labels. Repeating it as an empty cell left a
                    tall blank band across the top of the table. */}
                <th
                  scope="col"
                  rowSpan={2}
                  className={`${styles.gridPin} ${styles.gridPinName}`}
                  data-pin="name"
                  data-last-pinned=""
                >
                  Critical success factor
                  <small className={styles.gridHeadSub}>
                    Frequency, target and source
                  </small>
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
                        title="Fold into one column"
                      >
                        <span aria-hidden className={styles.gridMonthCaret}>▾</span> {m.label}
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
                        title="Show its weeks"
                      >
                        <span aria-hidden className={styles.gridMonthCaret}>▸</span> {m.label}
                      </button>
                    </th>
                  )
                )}
              </tr>
              <tr>
                {visibleMonths
                  .filter((m) => openMonths.has(m.key))
                  .flatMap((m) =>
                    m.weeks.map((w) => {
                      const open = openWeeks.includes(w);
                      return (
                        <th
                          key={w}
                          scope="col"
                          className={
                            open
                              ? `${styles.gridWeekHead} ${styles.gridWeekHeadOpen}`
                              : styles.gridWeekHead
                          }
                          title={
                            open && w !== weekEnding
                              ? "Still open: closes when this week does"
                              : undefined
                          }
                        >
                          {/* Wk 1, Wk 2 … of the month, with the Monday
                              it starts on under it (Option B, Jason
                              2026-11-06). The column is still keyed by
                              the Friday underneath: that is what every
                              value is stored against. */}
                          Wk {weekOfMonth(w)}
                          <small className={styles.gridHeadSub}>
                            {weekStartShort(w)}
                          </small>
                          {open ? (
                            <span className={styles.gridWeekTag}>
                              {w === weekEnding ? "This week" : "Last week"}
                            </span>
                          ) : null}
                        </th>
                      );
                    })
                  )}
              </tr>
            </thead>
            {/* One SortableContext per level. The group one lists every
                rendered area; the sibling rule is enforced on drop
                rather than by splitting this into a context per parent,
                because dnd-kit will not drag between contexts at all
                and the useful half of the gesture (seeing the band lift
                and follow the pointer) should still happen when
                somebody tries.

                Not while the filter is on. A drag among a filtered
                handful would be saved as the whole function's order,
                with the hidden rows' places decided by nobody. */}
            {shownGroups.map(({ group, rows }) => {
              return (
                <SortableGroupBody
                  key={group.functionId}
                  id={group.functionId}
                  enabled={
                    !needsOnly && areaIds.length > 1 && siblingIds(group).length > 1
                  }
                  rowIds={rows.map((r) => r.id)}
                  onKeyDown={(e) => handleAreaKeyDown(e, group.functionId)}
                >
                  <FunctionBand
                    group={group}
                    span={1 + columns.length}
                  />
                  {rows.map((row) => (
                    <SortableMeasureRow
                      key={row.id}
                      id={row.id}
                      enabled={!needsOnly && group.canLog && rows.length > 1}
                      label={row.description}
                      reserveHandle={authoring}
                    >
                      {(handle) => (
                        <>
                          <th
                            scope="row"
                            className={`${styles.gridPin} ${styles.gridPinName} ${styles.gridNameCell}`}
                            data-pin="name"
                          >
                            <div className={styles.nameCellInner}>
                              {handle}
                              <div className={styles.nameBlock}>
                                {/* THE NAME OPENS ITS SETTINGS, where the
                                    pencil in the actions column did.
                                    Only for somebody who can change it:
                                    to a reader it is the name, nothing
                                    to press. */}
                                {group.canLog ? (
                                  <button
                                    type="button"
                                    className={styles.nameButton}
                                    onClick={() => setEditing(row.id)}
                                    title="Edit its settings"
                                    data-measure-name=""
                                  >
                                    {row.description}
                                  </button>
                                ) : (
                                  <span className={styles.nameText} data-measure-name="">
                                    {row.description}
                                  </span>
                                )}
                                <MeasureMeta row={row} />
                                <ExternalMeasureNote measureId={row.id} />
                              </div>
                              {group.canLog ? (
                                <MeasureRowMenu
                                  row={row}
                                  onEdit={setEditing}
                                  onArchive={setArchiving}
                                  onMessage={setMessage}
                                />
                              ) : null}
                            </div>
                          </th>
                          {cellUnits(row, columns).map((col) => {
                            if (col.kind === "month") {
                              return (
                                <td
                                  key={`${row.id}-${col.key}`}
                                  className={styles.gridClosedCell}
                                />
                              );
                            }
                            const own = storageWeekFor(row.frequency, col.key);
                            const key = cellKey(row.id, own);
                            return (
                              <GridCellView
                                key={`${row.id}-${col.key}`}
                                row={row}
                                cell={cellOf(row, own)}
                                week={col.key}
                                span={col.span}
                                open={col.weeks.some((w) => openWeeks.includes(w))}
                                editable={cellEditable(row, col.key)}
                                canLog={group.canLog}
                                storageWeek={own}
                                valueKey={key}
                                value={values[key] ?? ""}
                                onValue={setValue}
                                onCommit={scheduleSave}
                                // Not while autosaving: the next cell has
                                // to stay typeable while the last saves.
                                disabled={pending && !autosave}
                              />
                            );
                          })}
                        </>
                      )}
                    </SortableMeasureRow>
                  ))}
                </SortableGroupBody>
              );
            })}
            {needsOnly && shownGroups.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={1 + columns.length} className={styles.gridFilterEmpty}>
                    Everything due last week and this week has a number.
                  </td>
                </tr>
              </tbody>
            ) : null}
          </table>
          </SortableContext>
          </DndContext>
        </div>

        <ul className={styles.gridLegend} aria-label="Key">
          <li>
            <i className={`${styles.gridLegendSwatch} ${styles.gridLegendOpen}`} aria-hidden />
            Open for entry: last week and this week
          </li>
          <li>
            <i className={`${styles.gridLegendSwatch} ${styles.gridLegendGood}`} aria-hidden />
            On target
          </li>
          <li>
            <i className={`${styles.gridLegendSwatch} ${styles.gridLegendOff}`} aria-hidden />
            Off target
          </li>
          <li>
            <b aria-hidden>·</b> Not due that week
          </li>
        </ul>
        </>
      ) : (
        <p className={styles.gridEmptyLine}>
          No Critical Success Factors have been created yet.
        </p>
      )}

      <ArchiveMeasureDialog
        measureId={archiving}
        onClose={() => setArchiving(null)}
        onError={(text) => setMessage({ ok: false, text })}
      />

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

// ---- The strip ---------------------------------------------------
//
// What do I still owe? Three chips and a filter, in place of the one
// line that said "2 of 6 still to log for Week 5 of August". Each chip
// is shown only when something in it is due: a caller with nothing to
// log this week is not told "0 of 0".
function StripView({
  strip,
  needsOnly,
  onToggleNeeds,
}: {
  strip: ReturnType<typeof summarizeStrip>;
  needsOnly: boolean;
  onToggleNeeds: () => void;
}) {
  const { last, current, onTargetLast, needsNumber } = strip;
  return (
    <div className={styles.strip}>
      {last && last.due > 0 ? (
        <span
          className={`${styles.stripChip} ${last.logged < last.due ? styles.stripChipTodo : ""}`}
          data-strip="last"
        >
          <span className={styles.stripDot} aria-hidden />
          Last week ({weekStartShort(last.week)}):{" "}
          <b>
            {last.logged} of {last.due}
          </b>{" "}
          logged
        </span>
      ) : null}
      {current.due > 0 ? (
        <span
          className={`${styles.stripChip} ${current.entered < current.due ? styles.stripChipTodo : ""}`}
          data-strip="current"
        >
          <span className={styles.stripDot} aria-hidden />
          This week ({weekStartShort(current.week)}):{" "}
          <b>
            {current.entered} of {current.due}
          </b>{" "}
          entered
        </span>
      ) : null}
      {onTargetLast && onTargetLast.judged > 0 ? (
        <span className={styles.stripChip} data-strip="on-target">
          <span
            className={`${styles.stripDot} ${onTargetLast.good < onTargetLast.judged ? styles.stripDotOff : ""}`}
            aria-hidden
          />
          On target last week:{" "}
          <b>
            {onTargetLast.good} of {onTargetLast.judged}
          </b>
        </span>
      ) : null}
      {needsOnly || needsNumber.length > 0 ? (
        <button
          type="button"
          className={needsOnly ? uiStyles.btnPrimary : uiStyles.btnSecondary}
          onClick={onToggleNeeds}
          aria-pressed={needsOnly}
        >
          {needsOnly ? "Showing only what needs a number" : "Show only what needs a number"}{" "}
          ({needsNumber.length})
        </button>
      ) : null}
    </div>
  );
}

// ---- The band above a function's rows ----------------------------
//
// Handle, name, Lead and how many measures, once per function. The
// label sticks to the left of the table's scroll area, so it stays
// beside the names while the weeks slide under the rest of the band.
function FunctionBand({ group, span }: { group: GridGroup; span: number }) {
  const count = group.rows.length;
  return (
    <tr className={styles.gridBand}>
      <th scope="rowgroup" colSpan={span} className={styles.gridBandCell}>
        <div className={styles.gridBandInner}>
          <AreaDragHandle title={group.functionTitle} />
          <Link
            href={`/chart/function/${group.functionId}`}
            className={styles.bandName}
            data-area-title=""
          >
            {group.functionTitle}
          </Link>
          {group.ownerName ? (
            <span className={styles.bandLead}>Lead: {group.ownerName}</span>
          ) : (
            <span className={styles.bandNoLead}>No Lead</span>
          )}
          <span className={styles.bandCount}>
            {count} {count === 1 ? "measure" : "measures"}
          </span>
        </div>
      </th>
    </tr>
  );
}

// The outside systems a value can be pulled from (0259), as people
// know them.
const SOURCE_NAMES: Record<string, string> = { hubspot: "HubSpot", google_sheet: "Google Sheets" };
const sourceName = (origin: string) => SOURCE_NAMES[origin] ?? origin;

// "Weekly · ≥ 200,000 · Google Sheets": what the Frequency and Target
// columns said, plus where the number comes from when it is connected.
function MeasureMeta({ row }: { row: GridRow }) {
  const info = useExternalMeasure(row.id);
  const source = info?.mapping ? sourceName(info.mapping.connector) : null;
  return (
    <div className={styles.nameMeta}>
      {row.frequencyLabel}
      {" · "}
      {row.target ? (
        <span className={styles.nameMetaTarget}>
          {/* NO ≥ ON A YES/NO MEASURE. "≥ Yes" is not a comparison
              anybody makes, and the direction it came from is not
              asked for on a text measure either. A target of "Yes"
              stands alone. */}
          {row.valueType === "text"
            ? null
            : row.direction === "higher_is_better"
              ? "≥ "
              : "≤ "}
          {formatMeasureValue(
            row.valueType,
            row.scale,
            { number: parseTypedNumber(row.target), text: row.target },
            row.target
          )}
        </span>
      ) : (
        "No target"
      )}
      {source ? (
        <>
          {" · "}
          <span className={styles.nameMetaSource}>{source}</span>
        </>
      ) : null}
    </div>
  );
}

// The ⋯ on a row: Edit settings, Pull now when the measure is
// connected and this caller may pull, and Archive. It replaced the
// pencil and bin in their own pinned column. No Move up or Move down:
// the handle beside the name does that, by pointer or by keyboard.
//
// PULL NOW IS THE DRAWER'S PULL NOW, the same action on the same
// default week (defaultPullWeek), without the week picker. Refreshes
// the page on success for the same reason the drawer does: the value,
// its status and its receipt change together, and re-deriving any of
// them here would be a second source of truth for a number.
function MeasureRowMenu({
  row,
  onEdit,
  onArchive,
  onMessage,
}: {
  row: GridRow;
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
  onMessage: (m: Message) => void;
}) {
  const info = useExternalMeasure(row.id);
  const { canPull, weeks } = useExternalMeasures();
  const router = useRouter();
  const [pulling, startPull] = useTransition();
  const mapping = info?.mapping ?? null;

  const items: RowMenuItem[] = [
    { label: "Edit settings", onSelect: () => onEdit(row.id) },
  ];
  if (mapping && canPull) {
    items.push({
      label: pulling ? "Pulling…" : "Pull now",
      disabled: pulling,
      onSelect: () =>
        startPull(async () => {
          const result = await pullExternalMeasureAction(
            row.id,
            defaultPullWeek(mapping, weeks)
          );
          onMessage({ ok: result.ok, text: result.message });
          if (result.ok) router.refresh();
        }),
    });
  }
  items.push({
    label: "Archive",
    separatorBefore: true,
    onSelect: () => onArchive(row.id),
  });

  return (
    <RowMenu
      ariaLabel={`More for ${row.description}`}
      label={<span aria-hidden>⋯</span>}
      caret={false}
      items={items}
      triggerClassName={styles.rowMenuButton}
    />
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
// value lands on the last week beginning in its month (September's
// ends 2 October), which is a week the grid has not drawn yet. A cell
// addressed by MONTH does not care: it spans whatever columns of its
// month are on screen and writes to the month's own week either way,
// so no future column has to appear on the page.
//
// A collapsed month is already one column, so its run is length 1 and
// this changes nothing there.
type CellUnit =
  | { kind: "month"; key: string; span: 1 }
  | { kind: "week"; key: string; span: number; weeks: string[] };

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
        : { kind: "week", key: c.key, span: 1, weeks: [c.key] }
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
      last.weeks.push(col.key);
      continue;
    }
    out.push({ kind: "week", key: col.key, span: 1, weeks: [col.key] });
  }
  return out;
}

// MEMOIZED, and every prop it takes is stable unless its own value
// changed: the row and cell come from `data`, the callbacks are
// useCallback'd, and the value is this box's string. Typing used to
// re-render every cell on the page on every keystroke (rows times
// visible weeks, because each got fresh closures); now it re-renders
// the one being typed in.
const GridCellView = memo(function GridCellView({
  row,
  cell,
  week,
  span,
  storageWeek,
  open,
  editable,
  canLog,
  valueKey,
  value,
  onValue,
  onCommit,
  disabled,
}: {
  row: GridRow;
  // This box's week as the server sees it, at its storage week.
  cell: GridCell | undefined;
  week: string;
  // How many week columns this cell covers. Always 1 except on a
  // monthly measure, where one cell spans its month.
  span: number;
  // WHERE THIS CELL'S VALUE ACTUALLY LIVES. The same week for a
  // weekly measure. For a monthly one it is the month's own week, so
  // the one box across the month reads and writes one number.
  storageWeek: string;
  // One of the two weeks open to everyone: tinted lime, whoever is
  // looking and whether or not they can type in it.
  open: boolean;
  // Whether this cell still accepts a value. For a monthly measure
  // that is true across its whole month, not only on the week the
  // value lands in.
  editable: boolean;
  canLog: boolean;
  valueKey: string;
  value: string;
  onValue: (key: string, v: string) => void;
  // Leaving the cell, for autosave.
  onCommit: () => void;
  disabled: boolean;
}) {
  const monthly = row.frequency === "monthly";
  // NO LONGER DRAWN. This used to put a 2px amber rule down the left
  // edge of the cell where a new target took effect. It read as an
  // alert about the number rather than a note about the yardstick,
  // and it drew the eye to the one thing on the row that was not a
  // value. Removed at Jason's request, 2026-09-19.
  //
  // The change is still KNOWN, and still explains itself on hover
  // ("Target changed from 98% to 0"), which is the honest half of what
  // this was for.
  const change = row.targetChanges.get(storageWeek);
  const [focused, setFocused] = useState(false);

  // Not expected: a muted dot (Option B). A fortnightly measure's off
  // week, or a week before the measure existed. It used to render as
  // nothing at all, because a monthly row was blank three weeks in
  // four and any mark there read as a skipped week; a monthly row is
  // one cell across its month now, so the dot only ever lands where
  // "not due" is the true and useful thing to say.
  if (!cell || !cell.expected) {
    return (
      <td
        className={`${styles.gridNotDue} ${open ? styles.gridCellOpen : ""}`}
        colSpan={span}
        title="Not due this week"
      >
        <span aria-hidden>·</span>
      </td>
    );
  }

  // STATUS COLOUR, from the cell's own status: cellStatus in grid.ts,
  // judged against the target in force that week. Green on target,
  // red off it, nothing for no target or no value. The open weeks
  // keep their lime; a box there shows its status on its left edge.
  const className = [
    styles.gridCell,
    styles[`gridCell_${cell.status}`],
    open ? styles.gridCellOpen : "",
    monthly ? styles.gridMonthBlock : "",
  ]
    .filter(Boolean)
    .join(" ");

  const targetTitle = change
    ? `Target changed from ${change.from ?? "none"} to ${change.to ?? "none"}`
    : cell.target
      ? `Target ${cell.target} this week`
      : undefined;
  // Who last changed this week's value, and what it was (0291).
  const changeTitle = cell.lastChange ? describeChange(cell.lastChange) : undefined;
  const title = [targetTitle, changeTitle].filter(Boolean).join(". ") || undefined;

  if (editable && canLog) {
    const month = monthKeyOf(storageWeek);
    return (
      <td className={className} colSpan={span} title={title}>
        <input
          className={styles.gridInput}
          // TEXT, NOT NUMBER, so a resting box can read "12,500" or
          // "95%": a number input will not hold a comma. While the box
          // has focus it shows the bare figure, which is what gets typed
          // and saved; the formatting is display only.
          type="text"
          inputMode={row.valueType === "text" ? undefined : "decimal"}
          value={focused ? value : entryDisplay(row, value)}
          // ONE VALUE FOR THE MONTH, and the box says so: it spans the
          // month's weeks and reads "Nov value" until it has one, so
          // it is not mistaken for one week's box that happens to be
          // wide.
          placeholder={monthly ? `${monthLabel(month).slice(0, 3)} value` : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onCommit();
          }}
          onChange={(e) => onValue(valueKey, e.target.value)}
          disabled={disabled}
          aria-label={
            monthly
              ? `${row.description}, ${monthLabel(month)}`
              : `${row.description}, ${weekLabel(week)}`
          }
        />
      </td>
    );
  }

  // A due week with no value is BLANK, not a dot: the dot means "not
  // due" (the key under the table says so), and a week somebody still
  // owes is not that.
  return (
    <td className={className} colSpan={span} title={title}>
      {cell.displayValue}
    </td>
  );
});

// "Changed by Sam on Oct 19, 2:14 PM. Was 12 (pulled from HubSpot)."
function describeChange(c: NonNullable<GridCell["lastChange"]>): string {
  const when = new Date(c.at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const who = c.by ? `Changed by ${c.by}` : c.nowPulledFrom ? `Updated from ${sourceName(c.nowPulledFrom)}` : "Changed";
  const was = c.wasPulledFrom ? `${c.was} (pulled from ${sourceName(c.wasPulledFrom)})` : c.was;
  return `${who} on ${when}. Was ${was}`;
}

function cellKey(measureId: string, week: string): string {
  return `${measureId}|${week}`;
}

// Given the cell rather than the row and week, so the caller looks it
// up once in the grid's per-row map.
function isDueInWeek(cell: GridCell | undefined): boolean {
  return cell?.expected ?? false;
}

// What goes IN the input box, which is the measure's own unit rather
// than what is stored. A millions measure holding 18000000 shows 18,
// because 18 is what somebody typed and what they expect to find.
//
// THOUSANDS AND MILLIONS SHOW TWO DECIMALS AT MOST (Jason, 2026-10-01).
// A thousands measure holding 152727 showed 152.727, a figure nobody
// typed: the sheet pull stores whole units. Rounded to 152.73 by
// toEntryText, the same as everywhere else the value appears
// (formatMeasureValue). Plain numbers keep what was entered.
function valueAt(row: GridRow, cell: GridCell | undefined): string {
  if (!cell?.value) return "";
  if (row.valueType === "text") return cell.value.text ?? "";
  if (cell.value.number == null || !Number.isFinite(cell.value.number)) return "";
  return toEntryText(cell.value.number, row.valueType, row.scale);
}

// An entry box at rest: the typed figure written the way the rest of
// the page writes it. Goes back through storage units so it is the same
// function the read-only cells use, and cannot drift from them.
// Anything that does not parse is left exactly as typed.
function entryDisplay(row: GridRow, typed: string): string {
  if (row.valueType === "text") return typed;
  // The same loose read the save does, so "12,500" typed by hand
  // shows as what will be stored.
  const n = parseTypedNumber(typed);
  if (n === null) return typed;
  return formatMeasureValue(row.valueType, row.scale, {
    number: toStoredNumber(n, row.valueType, row.scale),
    text: null,
  });
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  // Same geometry as PlusIcon: a 16 viewbox drawn at 14px, 1.4
  // stroke, round caps. Anything else reads as a second icon set at
  // the same size.
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
// tbody. A table may carry as many as it likes. The band is the
// tbody's first row, so it travels with its measures.
//
// THE AREA HANDLE LIVES IN THE BAND, which is a child of the tbody
// rather than the tbody itself, so its drag props have to reach
// across. A context is the cheapest way that does not turn every
// cell into a render prop.
const GroupDragContext = createContext<{
  enabled: boolean;
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown>;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}>({ enabled: false, attributes: {}, listeners: {}, onKeyDown: () => {} });

function AreaDragHandle({ title }: { title: string }) {
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
          // Not `opacity: 0`: the rows have to stay legible while they
          // move, because what you are aiming at is the area name.
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
  label,
  reserveHandle,
  children,
}: {
  id: string;
  enabled: boolean;
  label: string;
  // Whether to keep the handle's space when there is no handle, so
  // names line up between functions this caller can and cannot
  // reorder. A reader who can author nowhere gets no gap at all.
  reserveHandle: boolean;
  // The row's cells, handed the handle to place beside the name. A
  // render prop because the handle needs this row's drag props and
  // lives two elements down, inside the pinned name cell.
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !enabled });

  const handle = enabled ? (
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
  ) : reserveHandle ? (
    <span className={styles.rowDragSpacer} aria-hidden />
  ) : null;

  return (
    <tr
      ref={setNodeRef}
      className={styles.gridRow}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      data-dragging={isDragging ? "true" : undefined}
    >
      {children(handle)}
    </tr>
  );
}
