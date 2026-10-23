import { formatHours } from "./hours-back";
import { systemKindLabel } from "./types";
import type { Connection, SnapshotSystem } from "./systems-snapshot";

// Where each box and arrow sits on the systems map: one box per system
// around an ellipse, one arrow per connection from edge to edge. Used
// by the page's SVG and the PDF alike, as map-layout.ts is for the
// Capacity Map, so the two cannot draw different maps.

export const SYSTEMS_MAP = { width: 600, height: 380, boxW: 132, boxH: 46 } as const;

export type PlacedSystem = SnapshotSystem & { kindLabel: string; x: number; y: number; w: number; h: number };
export type PlacedArrow = {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  handCarried: boolean;
  // Hours a week carried, on a hand-carried arrow only.
  label: string | null;
  lx: number;
  ly: number;
  title: string;
};

function place(systems: readonly SnapshotSystem[]): PlacedSystem[] {
  const { width, height, boxW, boxH } = SYSTEMS_MAP;
  const cx = width / 2, cy = height / 2;
  const rx = width / 2 - boxW / 2 - 8, ry = height / 2 - boxH / 2 - 8;
  return systems.map((s, i) => {
    const angle = systems.length === 1 ? 0 : -Math.PI / 2 + (i / systems.length) * Math.PI * 2;
    const r = systems.length === 1 ? 0 : 1;
    const x = cx + Math.cos(angle) * rx * r - boxW / 2;
    const y = cy + Math.sin(angle) * ry * r - boxH / 2;
    return { ...s, kindLabel: systemKindLabel(s.kind), x, y, w: boxW, h: boxH };
  });
}

// Where the line from a box's centre toward (tx, ty) leaves the box.
function edge(b: PlacedSystem, tx: number, ty: number, pad = 4): { x: number; y: number } {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min((b.w / 2 + pad) / Math.abs(dx || 1e-9), (b.h / 2 + pad) / Math.abs(dy || 1e-9));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function layoutSystemsMap(systems: readonly SnapshotSystem[], connections: readonly Connection[]) {
  const boxes = place(systems);
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const pairs = new Set(connections.map((c) => `${c.fromId}>${c.toId}`));
  const arrows: PlacedArrow[] = [];
  for (const c of connections) {
    const a = byId.get(c.fromId), b = byId.get(c.toId);
    if (!a || !b) continue;
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    // Two connections between the same systems, one each way, sit side
    // by side rather than on top of each other.
    const both = pairs.has(`${c.toId}>${c.fromId}`);
    const len = Math.hypot(bc.x - ac.x, bc.y - ac.y) || 1;
    const nx = (-(bc.y - ac.y) / len) * (both ? 7 : 0), ny = ((bc.x - ac.x) / len) * (both ? 7 : 0);
    const start = edge(a, bc.x + nx, bc.y + ny), end = edge(b, ac.x + nx, ac.y + ny);
    const x1 = start.x + nx, y1 = start.y + ny, x2 = end.x + nx, y2 = end.y + ny;
    const hours = `${formatHours(c.hoursCarried)} ${c.hoursCarried === 1 ? "hour" : "hours"} a week`;
    arrows.push({
      key: `${c.fromId}>${c.toId}`,
      x1,
      y1,
      x2,
      y2,
      handCarried: c.handCarried,
      label: c.handCarried ? hours : null,
      lx: (x1 + x2) / 2 + nx * 2,
      ly: (y1 + y2) / 2 + ny * 2 - 4,
      title: `${c.from} to ${c.to}: ${c.whatMoves.join(", ")}${c.handCarried ? `, ${hours} carried by hand` : ""}`,
    });
  }
  return { boxes, arrows };
}
