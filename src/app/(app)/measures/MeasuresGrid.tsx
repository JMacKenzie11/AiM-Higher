"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  logMeasureEntriesAction,
  type MeasureEntryInput,
} from "@/lib/measures/actions";
import type { GridData, GridRow } from "@/lib/measures/grid";
import { EditMeasureForm, ArchiveMeasureButton } from "./EditMeasureForm";
import { ExternalMeasureNote } from "./external/ExternalMeasureNote";
import { ExternalSourceControls } from "./external/ExternalSourceControls";
import { PencilIcon } from "@/components/ui/PencilIcon";
import { PlusIcon } from "@/components/ui/PlusIcon";
import { formatShortDate } from "@/lib/dates";
import uiStyles from "@/components/ui/ui.module.css";
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
  { key: "actions", width: 64 },
  { key: "name", width: 240 },
  { key: "freq", width: 96 },
  { key: "target", width: 84 },
];

function pinnedColumns(authoring: boolean) {
  return PINNED.filter((c) => authoring || c.key !== "actions");
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
  target_direction: "higher_is_better" as const,
  update_frequency: "weekly",
  auto_track: true,
  show_on_dashboard: true,
};

export function MeasuresGrid({
  data,
  weekEnding,
  isAdmin,
  trackingEnabled,
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
  trackingEnabled: boolean;
}) {
  // The actions column shows if this caller can author anywhere.
  const authoring = isAdmin || data.groups.some((g) => g.canLog);
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

  // The weeks that accept input: the one that just closed, and the
  // current one. Oldest first, so the grid reads left to right.
  const editableWeeks = useMemo(
    () =>
      [data.previousWeekEnding, weekEnding].filter(
        (w): w is string => w !== null
      ),
    [data.previousWeekEnding, weekEnding]
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
          editableWeeks.map((w) => [cellKey(r.id, w), valueAt(r, w)])
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
    // Every editable cell this caller owns, across both open weeks.
    // A blank is skipped by the action, so sending them all is how a
    // value typed into either column gets saved by one button.
    const entries: MeasureEntryInput[] = data.groups
      .filter((g) => g.canLog)
      .flatMap((g) =>
        g.rows.flatMap((r) =>
          editableWeeks
            .filter((w) => isDueInWeek(r, w))
            .map((w) => ({
              measureId: r.id,
              valueType: r.valueType,
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
  const visibleMonths = useMemo(
    () => (trackingEnabled ? data.months : []),
    [data.months, trackingEnabled]
  );

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

      // 1. Where each pinned column actually starts. Measured rather
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
        for (const cell of pinnedCells) {
          if (cell.dataset.pin === col.key) cell.style.left = `${left}px`;
        }
        pinnedRight = Math.round(box.right - tableLeft);
      }

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
      //    EVERY TIME AFTER: back where the reader was. Opening a
      //    month used to throw them to the current week and closing
      //    one did it again, so exploring the history fought back.
      requestAnimationFrame(() => {
        if (!openedRef.current || !anchor) {
          el.scrollLeft = el.scrollWidth;
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

  if (!data.hasRows) return null;

  return (
    <div className={styles.gridStack}>
      {/* ONE TOOLBAR, whichever half of it has anything in it.
 
          The add button had a second placement for a company without
          Success Tracking, because there was no toolbar to hang it
          from then. That rendered it alone in a bare row above the
          table, left-aligned, nothing like where it sits with the
          flag on — which is exactly what Geo-Sci looks like in
          production, where the flag is off and dev's is on. */}
      {(trackingEnabled && writableRows.length > 0) ||
      addableGroups.length > 0 ? (
        <div className={styles.gridToolbar}>
          {trackingEnabled && writableRows.length > 0 ? (
            <p
              className={
                outstanding === 0 ? styles.outstandingDone : styles.outstanding
              }
            >
              {outstanding === 0
                ? `All ${writableRows.length} logged for the week ending ${formatShortDate(chasedWeek)}.`
                : `${outstanding} of ${writableRows.length} still to log for the week ending ${formatShortDate(chasedWeek)}.`}
            </p>
          ) : (
            // Holds the left half of the row so the actions stay
            // right, rather than sliding across when there is nothing
            // to count.
            <span />
          )}
          <div className={styles.gridToolbarActions}>
            {trackingEnabled && writableRows.length > 0 ? (
              <button
                type="button"
                className={uiStyles.btnPrimary}
                onClick={save}
                disabled={pending}
              >
                {pending ? "Saving…" : "Save this week"}
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
                <th
                  scope="col"
                  rowSpan={2}
                  className={`${styles.gridPin} ${styles.gridPinActions}`}
                      data-pin="actions"
                >
                  <span className={styles.visuallyHidden}>Actions</span>
                </th>
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
                          : editableWeeks.includes(w)
                            ? `${styles.gridWeekHead} ${styles.gridWeekHeadOpen}`
                            : styles.gridWeekHead
                      }
                      title={
                        editableWeeks.includes(w) && w !== weekEnding
                          ? "Still open: closes when the next week does"
                          : undefined
                      }
                    >
                      {w.slice(8)}
                    </th>
                  ))
                )}
            </tr>
          </thead>
          <tbody>
            {data.groups
              .filter((g) => g.rows.length > 0)
              .map((group) =>
                group.rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={i === 0 ? styles.gridGroupStart : undefined}
                  >
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
                          <Link
                            href={`/chart/function/${group.functionId}`}
                            className={styles.fnTitleLink}
                          >
                            {group.functionTitle}
                          </Link>
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
                          <span className={styles.gridDir} aria-hidden>
                            {row.direction === "higher_is_better" ? "≥" : "≤"}
                          </span>{" "}
                          {row.target}
                        </>
                      ) : (
                        <span className={styles.gridNoTarget}>Not set</span>
                      )}
                    </td>
                    {columns.map((col) =>
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
                          isCurrent={col.key === weekEnding}
                          editable={editableWeeks.includes(col.key)}
                          canLog={group.canLog && trackingEnabled}
                          value={values[cellKey(row.id, col.key)] ?? ""}
                          onChange={(v) =>
                            setValues((prev) => ({
                              ...prev,
                              [cellKey(row.id, col.key)]: v,
                            }))
                          }
                          disabled={pending}
                        />
                      )
                    )}
                  </tr>
                ))
              )}
          </tbody>
        </table>
      </div>

      {editingRow || adding ? (
        <>
          {/* A scrim, so a click anywhere else closes it. The third
              dismissal, beside Escape and Cancel, and the one people
              reach for without being taught. */}
          <div
            className={styles.drawerScrim}
            onClick={() => {
              setEditing(null);
              setAdding(null);
            }}
            aria-hidden
          />
          <aside
            className={styles.drawer}
            role="dialog"
            aria-modal="false"
            aria-labelledby="measure-drawer-title"
          >
            <header className={styles.drawerHead}>
              <div>
                <p className={styles.drawerEyebrow}>Critical success factor</p>
                <h2 id="measure-drawer-title" className={styles.drawerTitle}>
                  {editingRow ? editingRow.description : "Add a new one"}
                </h2>
              </div>
              <button
                type="button"
                className={styles.drawerClose}
                onClick={() => {
                  setEditing(null);
                  setAdding(null);
                }}
                aria-label="Close"
              >
                <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
                  <path
                    d="M4 4 l8 8 M12 4 l-8 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.4}
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </header>
            <div className={styles.drawerBody}>
              <EditMeasureForm
                key={editingRow ? editingRow.id : `new-${adding}`}
                measure={
                  editingRow
                    ? {
                        id: editingRow.id,
                        description: editingRow.description,
                        target: editingRow.target,
                        value_type: editingRow.valueType,
                        target_direction: editingRow.direction,
                        update_frequency: editingRow.frequency,
                        auto_track: editingRow.autoTrack,
                        show_on_dashboard: editingRow.showOnDashboard,
                      }
                    : BLANK_MEASURE
                }
                outcomeTitle={editingRow?.description ?? ""}
                outcomeDescription={editingRow?.detail ?? null}
                trackingEnabled={trackingEnabled}
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
                <ExternalSourceControls measureId={editingRow.id} />
              ) : (
                <p className={styles.drawerHint}>
                  Connecting this to a spreadsheet becomes available as
                  soon as you add it.
                </p>
              )}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}

function GridCellView({
  row,
  week,
  isCurrent,
  editable,
  canLog,
  value,
  onChange,
  disabled,
}: {
  row: GridRow;
  week: string;
  isCurrent: boolean;
  // Whether this week still accepts a value: the current one and the
  // one that just closed.
  editable: boolean;
  canLog: boolean;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const cell = row.cells.find((c) => c.weekEnding === week);
  const change = row.targetChanges.get(week);

  // Not expected: render nothing at all. Not a dash, not a zero, not
  // a muted dot. A monthly row is blank three weeks in four and any
  // mark in those cells reads as a week somebody skipped.
  if (!cell || !cell.expected) {
    return <td className={styles.gridNotDue} aria-hidden />;
  }

  const className = [
    styles.gridCell,
    styles[`gridCell_${cell.status}`],
    isCurrent ? styles.gridCellCurrent : "",
    // The just-closed week reads as open too, more quietly than this
    // week: it is the one with a deadline, not the one you are
    // filling in as you go.
    editable && !isCurrent ? styles.gridCellOpen : "",
    change ? styles.gridCellTargetMoved : "",
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
      <td className={className} title={title}>
        <input
          className={styles.gridInput}
          type={row.valueType === "text" ? "text" : "number"}
          inputMode={row.valueType === "text" ? undefined : "decimal"}
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={`${row.description}, week ending ${week}`}
        />
      </td>
    );
  }

  return (
    <td className={className} title={title}>
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

function valueAt(row: GridRow, week: string): string {
  const cell = row.cells.find((c) => c.weekEnding === week);
  if (!cell?.value) return "";
  if (row.valueType === "text") return cell.value.text ?? "";
  if (cell.value.number == null || !Number.isFinite(cell.value.number)) return "";
  return String(cell.value.number);
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
