import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTopModalLayer, pushModalLayer, wrapTabTarget } from "./use-modal-focus";

// The suite runs in node with no DOM, so the trap's decision is tested
// as the pure function it is, and the wiring is checked in the source.

describe("wrapTabTarget", () => {
  const stops = ["close", "title", "save"];

  it("wraps Tab from the last stop to the first", () => {
    expect(wrapTabTarget(stops, "save", false)).toBe("close");
  });

  it("wraps Shift+Tab from the first stop to the last", () => {
    expect(wrapTabTarget(stops, "close", true)).toBe("save");
  });

  it("leaves Tab in the middle to the browser", () => {
    expect(wrapTabTarget(stops, "title", false)).toBeNull();
    expect(wrapTabTarget(stops, "title", true)).toBeNull();
  });

  it("pulls focus back in when it is outside the modal", () => {
    expect(wrapTabTarget(stops, null, false)).toBe("close");
    expect(wrapTabTarget(stops, null, true)).toBe("save");
    expect(wrapTabTarget(stops, "sidebar-link", false)).toBe("close");
  });

  it("does nothing with no stops", () => {
    expect(wrapTabTarget([], null, false)).toBeNull();
  });
});

describe("the modal layer stack", () => {
  it("lets only the top modal answer keys, and hands back on close", () => {
    const drawer = {};
    const confirm = {};
    const popDrawer = pushModalLayer(drawer);
    expect(isTopModalLayer(drawer)).toBe(true);
    const popConfirm = pushModalLayer(confirm);
    expect(isTopModalLayer(drawer)).toBe(false);
    expect(isTopModalLayer(confirm)).toBe(true);
    popConfirm();
    expect(isTopModalLayer(drawer)).toBe(true);
    popDrawer();
    expect(isTopModalLayer(drawer)).toBe(false);
  });
});

const read = (p: string) => readFileSync(path.resolve(__dirname, "../../..", p), "utf8");

describe("the modals use it", () => {
  it("Drawer traps by default unless it is a side panel", () => {
    const drawer = read("src/components/ui/Drawer.tsx");
    expect(drawer).toContain("const trap = trapFocus ?? !side;");
    expect(drawer).toContain("trapTab(panelRef.current, e)");
  });

  it("ConfirmDialog and Share this chat use useModalFocus", () => {
    expect(read("src/components/ui/ConfirmDialog.tsx")).toContain("useModalFocus({");
    expect(read("src/app/(app)/ask-aimee/[conversationId]/ShareChatButton.tsx")).toContain(
      "useModalFocus({"
    );
  });
});
