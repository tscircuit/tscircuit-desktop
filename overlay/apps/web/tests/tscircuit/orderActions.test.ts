import { describe, expect, it } from "vite-plus/test";

import type { ThreadRightPanelState } from "../../src/rightPanelStore";
import { circuitSurface } from "../../src/tscircuit/circuitSurface";
import { focusedCircuitFile, withOrderFile } from "../../src/tscircuit/orderActions";
import { orderSurface } from "../../src/tscircuit/orderSurface";

const panel = (fields: Partial<ThreadRightPanelState>): ThreadRightPanelState => ({
  isOpen: true,
  activeSurfaceId: null,
  surfaces: [],
  ...fields,
});

describe("focusedCircuitFile", () => {
  const surfaces = [circuitSurface("boards/led.tsx"), { id: "diff", kind: "diff" } as const];

  it("names the file of a Circuit tab that is on screen", () => {
    expect(focusedCircuitFile(panel({ surfaces, activeSurfaceId: "circuit" }))).toBe(
      "boards/led.tsx",
    );
    // A Circuit tab opened from the menu shows the project's entry file and names none.
    expect(
      focusedCircuitFile(panel({ surfaces: [circuitSurface()], activeSurfaceId: "circuit" })),
    ).toBeUndefined();
  });

  it("finds no circuit on screen behind another tab, or in a closed panel", () => {
    expect(focusedCircuitFile(panel({ surfaces, activeSurfaceId: "diff" }))).toBeNull();
    expect(
      focusedCircuitFile(panel({ surfaces, activeSurfaceId: "circuit", isOpen: false })),
    ).toBeNull();
    expect(focusedCircuitFile(panel({}))).toBeNull();
  });
});

describe("withOrderFile", () => {
  it("sets and clears the Order tab's file, and touches no other tab", () => {
    const before = panel({ surfaces: [circuitSurface("index.tsx"), orderSurface()] });
    const chosen = withOrderFile(before, "boards/led.tsx");
    expect(chosen.surfaces).toEqual([
      circuitSurface("index.tsx"),
      { id: "order", kind: "order", relativePath: "boards/led.tsx" },
    ]);
    expect(withOrderFile(chosen, undefined).surfaces).toEqual(before.surfaces);
  });
});
