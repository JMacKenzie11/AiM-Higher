"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  TransformWrapper,
  TransformComponent,
  useControls,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import styles from "./chart.module.css";

// Pan-and-zoom canvas for the org chart. Standard org-chart UX —
// scroll wheel or +/- to zoom, click-and-drag on empty space to
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
const MAX_HEIGHT = 720;

function fitToView(api: ReactZoomPanPinchRef, frame: HTMLElement | null) {
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
  const widthScale = Math.min((cW - padX * 2) / nW, 1);

  // THE FRAME TAKES THE HEIGHT OF WHAT IS IN IT.
  //
  // It was `min(70vh, 720px)` whatever the tree's shape. Measured on
  // Benson at 393px: the tree rendered 145px tall inside a 596px
  // frame — 451px of empty card under a chart, which is the "drowning
  // in the card" this fixes.
  const maxH = Math.min(
    Math.round(window.innerHeight * 0.7),
    MAX_HEIGHT
  );
  const wanted = Math.round(nH * widthScale + padTop + padBottom);
  const cH = Math.max(MIN_HEIGHT, Math.min(wanted, maxH));

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

  // Height only binds when the tree is too deep to fit at its
  // width-fitted scale — a tall chart on a short screen, where the
  // frame has already been clamped to maxH.
  const scale = Math.min(widthScale, (cH - padTop - padBottom) / nH, 1);
  const x = (cW - nW * scale) / 2;
  // Centred in what is left BELOW the controls. On a wide screen
  // padTop and padBottom are both FIT_PADDING, so this is the plain
  // centring it has always been and the desktop result is unchanged
  // to the pixel.
  const y = padTop + (cH - padTop - padBottom - nH * scale) / 2;
  api.setTransform(x, y, scale, 0);
}

export function PanZoomTree({ children }: { children: ReactNode }) {
  const ref = useRef<ReactZoomPanPinchRef>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const doFit = useCallback(() => {
    if (ref.current) fitToView(ref.current, frameRef.current);
  }, []);

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

  return (
    <TransformWrapper
      ref={ref}
      minScale={0.15}
      maxScale={2}
      initialScale={1}
      limitToBounds={false}
      wheel={{ step: 0.15 }}
      pinch={{ step: 5 }}
      doubleClick={{ disabled: true }}
      panning={{
        // Any element carrying `chart-no-pan` will not trigger a pan
        // on mousedown — used on the drag handle so dnd-kit gets a
        // clean pointer stream for reorder.
        excluded: ["chart-no-pan"],
      }}
    >
      <PanZoomInner onFit={doFit} frameRef={frameRef}>
        {children}
      </PanZoomInner>
    </TransformWrapper>
  );
}

function PanZoomInner({
  children,
  onFit,
  frameRef,
}: {
  children: ReactNode;
  onFit: () => void;
  frameRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className={styles.panZoomFrame} ref={frameRef}>
      <PanZoomControls onFit={onFit} />
      <TransformComponent
        wrapperClass={styles.panZoomWrapper}
        contentClass={styles.panZoomContent}
      >
        {children}
      </TransformComponent>
    </div>
  );
}

function PanZoomControls({ onFit }: { onFit: () => void }) {
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
    </div>
  );
}
