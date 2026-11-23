"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  TransformWrapper,
  TransformComponent,
  useControls,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import styles from "./chart.module.css";

// Pan-and-zoom canvas for the org chart. Ctrl/⌘ + scroll wheel,
// a trackpad pinch, or +/- to zoom, click-and-drag on empty space to
// pan, click the fit-to-view control to snap back to the full
// tree. Handles arbitrarily wide/deep trees without clipping and
// without shrinking cards past readability.
//
// dnd-kit vs pan interaction:
//   Card drag handles opt out of pan (see the `chart-no-pan` class
//   on the handle button in DraggableTree). That way clicking-and-
//   dragging the drag-handle triggers dnd-kit's PointerSensor for
//   reorder; dragging anywhere else on the canvas pans the whole
//   tree. Card body clicks still fire because pan requires
//   movement — a click without drag lets the underlying <Link>
//   navigate to the function detail page.

// Breathing room around the tree when we auto-fit so cards don't
// press against the pan/zoom controls or the card edges.
//
// Less of it on a phone, because there it is not breathing room, it
// is most of the canvas: measured at 393px the viewport is 279px
// wide, so 32px a side spent 23% of the width on margin and dragged
// the fit scale down with it.
const FIT_PADDING = 32;
const FIT_PADDING_NARROW = 12;
const NARROW = 480;

// Room for the +/-/fit controls, which float at the top right of the
// canvas. On a wide screen the tree is big enough that they sit over
// its empty top corner; on a phone the whole chart is 188px tall and
// they landed on the Visionary box. The old fixed-height frame hid
// this — there was so much spare canvas that the tree never reached
// the corner.
const CONTROLS_CLEARANCE = 56;

// The canvas never gets shorter than this. A one-box chart in a 200px
// frame still reads as a canvas you can pan; in an 80px one it reads
// as a clipping bug.
const MIN_HEIGHT = 200;

// How far the fit may ENLARGE the chart. On the page a card is never
// drawn bigger than its own size; full screen, with the sidebar and
// header gone, there is room to draw it a little larger.
const MAX_FIT_PAGE = 1;
const MAX_FIT_FULLSCREEN = 1.25;

function fitToView(
  api: ReactZoomPanPinchRef,
  frame: HTMLElement | null,
  maxFit: number
) {
  const wrapper = api.instance.wrapperComponent;
  const content = api.instance.contentComponent;
  if (!wrapper || !content) return;
  const cW = wrapper.clientWidth;
  // offsetWidth/Height report the layout box, unaffected by CSS
  // transform — so we get the tree's true (pre-scale) size even if
  // the user has already zoomed.
  const nW = content.offsetWidth;
  const nH = content.offsetHeight;
  if (!cW || !nW || !nH) return;

  const narrow = cW < NARROW;
  const padX = narrow ? FIT_PADDING_NARROW : FIT_PADDING;
  const padBottom = narrow ? FIT_PADDING_NARROW : FIT_PADDING;
  const padTop = narrow ? CONTROLS_CLEARANCE : FIT_PADDING;

  // WIDTH FIRST, AND WIDTH ALONE, and that ordering is what keeps
  // this from oscillating. We are about to change the frame's height,
  // which changes wrapper.clientHeight, which re-fires the
  // ResizeObserver below. A scale derived from the height would then
  // feed back into the height it was derived from. A width-derived
  // scale is fixed before the height moves, so the next pass computes
  // the same number and stops.
  const widthScale = Math.min((cW - padX * 2) / nW, maxFit);

  // THE FRAME TAKES THE HEIGHT OF WHAT IS IN IT, all of it.
  //
  // It was `min(70vh, 720px)` whatever the tree's shape, then the
  // tree's height capped at that. The cap is gone with the stacked
  // layout (layout.ts): a stacked chart is narrow and tall, and
  // capping its height made the HEIGHT set the scale, which shrank it
  // back to the unreadable size stacking was meant to fix. Now the
  // width alone sets the scale and the page scrolls down the chart,
  // which is why the wheel no longer zooms without Ctrl/⌘ (below).
  const wanted = Math.round(nH * widthScale + padTop + padBottom);
  const cH = Math.max(MIN_HEIGHT, wanted);

  if (frame) {
    // Only when it actually moves. Writing an identical value still
    // notifies the ResizeObserver on some engines.
    const current = Number.parseFloat(
      frame.style.getPropertyValue("--tree-h")
    );
    if (!Number.isFinite(current) || Math.abs(current - cH) > 1) {
      frame.style.setProperty("--tree-h", `${cH}px`);
    }
  }

  const scale = widthScale;
  const x = (cW - nW * scale) / 2;
  // Centred in what is left BELOW the controls. On a wide screen
  // padTop and padBottom are both FIT_PADDING, so this is the plain
  // centring it has always been and the desktop result is unchanged
  // to the pixel.
  const y = padTop + (cH - padTop - padBottom - nH * scale) / 2;
  api.setTransform(x, y, scale, 0);
}

export function PanZoomTree({
  title,
  children,
}: {
  // Shown in the bar across the top in full screen.
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<ReactZoomPanPinchRef>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenRef = useRef(false);
  fullscreenRef.current = fullscreen;

  const doFit = useCallback(() => {
    if (ref.current) {
      fitToView(
        ref.current,
        frameRef.current,
        fullscreenRef.current ? MAX_FIT_FULLSCREEN : MAX_FIT_PAGE
      );
    }
  }, []);

  // Full screen: Escape leaves, the page behind stops scrolling, and
  // focus goes to Exit and comes back to the button that opened it.
  // The resize observer refits on the way in and out, since the
  // canvas changes width; the explicit fit covers a window where the
  // width happens not to change.
  useEffect(() => {
    if (!fullscreen) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    exitRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The function drawer opens over full screen and has its own
      // Escape; that one closes the drawer, not this.
      if (document.querySelector('[role="dialog"]')) return;
      setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    const raf = requestAnimationFrame(doFit);
    return () => {
      document.body.style.overflow = before;
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      requestAnimationFrame(doFit);
      openRef.current?.focus();
    };
  }, [fullscreen, doFit]);

  // Fit on mount and on container resize. The library's built-in
  // centerOnInit only centres — it doesn't scale — so a wide tree
  // lands clipped. Double rAF lets React commit and the browser
  // lay out before we measure.
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(doFit);
    });
    const wrapper = ref.current?.instance.wrapperComponent;
    const observer = wrapper ? new ResizeObserver(() => doFit()) : null;
    if (wrapper && observer) observer.observe(wrapper);
    return () => {
      cancelAnimationFrame(raf1);
      observer?.disconnect();
    };
  }, [doFit]);

  // One structure in and out of full screen, so the canvas is never
  // remounted (the resize observer above holds its wrapper): the
  // outer div changes class, and the bar slots in ahead of the body.
  return (
    <div
      className={fullscreen ? styles.fullscreen : undefined}
      role={fullscreen ? "region" : undefined}
      aria-label={fullscreen ? `${title}, full screen` : undefined}
    >
      {fullscreen ? (
        <div className={styles.fullscreenBar}>
          <h2 className={styles.fullscreenTitle}>{title}</h2>
          <button
            ref={exitRef}
            type="button"
            className={styles.fullscreenExit}
            onClick={() => setFullscreen(false)}
          >
            <span aria-hidden="true">✕</span> Exit full screen
          </button>
        </div>
      ) : null}
      <div className={fullscreen ? styles.fullscreenBody : undefined}>
    <TransformWrapper
      ref={ref}
      minScale={0.15}
      maxScale={2}
      initialScale={1}
      limitToBounds={false}
      // The frame is now the chart's full height and the page scrolls
      // down it, so a plain wheel must scroll. Ctrl/⌘ + wheel zooms,
      // which is also what a trackpad pinch sends.
      wheel={{ step: 0.15, activationKeys: ["Control", "Meta"] }}
      pinch={{ step: 5 }}
      doubleClick={{ disabled: true }}
      panning={{
        // Any element carrying `chart-no-pan` will not trigger a pan
        // on mousedown — used on the drag handle so dnd-kit gets a
        // clean pointer stream for reorder.
        excluded: ["chart-no-pan"],
      }}
    >
      <PanZoomInner
        onFit={doFit}
        frameRef={frameRef}
        fullscreen={fullscreen}
        onFullscreen={() => setFullscreen(true)}
        openRef={openRef}
      >
        {children}
      </PanZoomInner>
    </TransformWrapper>
      </div>
    </div>
  );
}

function PanZoomInner({
  children,
  onFit,
  frameRef,
  fullscreen,
  onFullscreen,
  openRef,
}: {
  children: ReactNode;
  onFit: () => void;
  frameRef: React.RefObject<HTMLDivElement | null>;
  fullscreen: boolean;
  onFullscreen: () => void;
  openRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className={styles.panZoomFrame} ref={frameRef}>
      <PanZoomControls
        onFit={onFit}
        fullscreen={fullscreen}
        onFullscreen={onFullscreen}
        openRef={openRef}
      />
      <TransformComponent
        wrapperClass={styles.panZoomWrapper}
        contentClass={styles.panZoomContent}
      >
        {children}
      </TransformComponent>
    </div>
  );
}

function PanZoomControls({
  onFit,
  fullscreen,
  onFullscreen,
  openRef,
}: {
  onFit: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  openRef: React.RefObject<HTMLButtonElement | null>;
}) {
  // useControls only works inside TransformWrapper — this is the
  // library's way of exposing zoom actions to arbitrary sibling
  // components without prop-drilling refs.
  const { zoomIn, zoomOut } = useControls();
  return (
    <div className={styles.panZoomControls}>
      <button
        type="button"
        onClick={() => zoomIn()}
        aria-label="Zoom in"
        title="Zoom in"
        className={`${styles.panZoomButton} chart-no-pan`}
      >
        +
      </button>
      <button
        type="button"
        onClick={() => zoomOut()}
        aria-label="Zoom out"
        title="Zoom out"
        className={`${styles.panZoomButton} chart-no-pan`}
      >
        −
      </button>
      <button
        type="button"
        onClick={onFit}
        aria-label="Fit to view"
        title="Fit to view"
        className={`${styles.panZoomButton} chart-no-pan`}
      >
        ⤢
      </button>
      {fullscreen ? null : (
        <button
          ref={openRef}
          type="button"
          onClick={onFullscreen}
          className={`${styles.panZoomButton} ${styles.panZoomLabelButton} chart-no-pan`}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
          </svg>
          Full screen
        </button>
      )}
    </div>
  );
}
