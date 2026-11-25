import { describe, expect, it } from "vite-plus/test";
import { circuitPanelReducer, initialCircuitPanelState } from "../../src/tscircuit/circuitViews";
import { secondCircuitView } from "../../src/tscircuit/circuitSplit";

const rendered = (preferred: "pcb" | "schematic", counts: Record<string, number>) =>
  circuitPanelReducer(initialCircuitPanelState(preferred), {
    type: "circuit_rendered",
    file: "index.tsx",
    counts,
  });

describe("second circuit view", () => {
  it("opens the other available layout, not an empty view", () => {
    const counts = { pcb_board: 1, schematic_component: 1 };
    expect(secondCircuitView(rendered("pcb", counts).view)).toBe("schematic");
    expect(secondCircuitView(rendered("schematic", counts).view)).toBe("pcb");
    expect(secondCircuitView(rendered("pcb", { pcb_component: 1 }).view)).toBe("bom");
    expect(secondCircuitView(rendered("schematic", { schematic_component: 1 }).view)).toBe(
      "source",
    );
  });

  it("retains independent navigation and error recovery for the same file", () => {
    const left = rendered("pcb", { pcb_board: 1, schematic_component: 1 });
    let right = rendered("schematic", { pcb_board: 1, schematic_component: 1 });
    right = circuitPanelReducer(right, { type: "user_picked", file: "index.tsx", screen: "cad" });
    expect(left.view.screen).toBe("pcb");
    expect(right.view.screen).toBe("cad");
    right = circuitPanelReducer(right, {
      type: "run_failed",
      file: "index.tsx",
      message: "Failed",
    });
    expect(right.view.screen).toBe("errors");
    expect(left.view.executionError).toBeNull();
    expect(secondCircuitView(right.view)).toBe("source");
    right = circuitPanelReducer(right, { type: "run_completed", file: "index.tsx", failed: false });
    expect(right.view.screen).toBe("cad");
  });
});
