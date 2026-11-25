import { describe, expect, it } from "vite-plus/test";

import {
  appendToPrompt,
  type CircuitPanelState,
  circuitPanelReducer,
  type CircuitViewAction,
  countErrors,
  fixErrorPrompt,
  initialCircuitPanelState,
  preferredViewFrom,
  unmutedViews,
  viewStateForFile,
  viewsWithContent,
  viewTabs,
} from "../../src/tscircuit/circuitViews";

const BOARD = { pcb_board: 1, pcb_component: 2, schematic_component: 2, schematic_group: 1 };
const SYSTEM_ONLY = { system_block_page: 1, system_block_component: 2 };
const WITH_DRAWINGS = { ...BOARD, drawing_page: 1, drawing_part_view: 2 };

const run = (
  actions: ReadonlyArray<CircuitViewAction & { file?: string }>,
  preferred: CircuitPanelState["preferred"] = "pcb",
) =>
  actions.reduce(
    (state, action) => circuitPanelReducer(state, { file: "index.tsx", ...action }),
    initialCircuitPanelState(preferred),
  );

describe("viewsWithContent", () => {
  it.each([
    ["a board with parts", BOARD, ["pcb", "cad", "bom", "schematic"]],
    ["a board with drawings", WITH_DRAWINGS, ["pcb", "cad", "bom", "schematic", "drawing"]],
    ["a system diagram on its own", SYSTEM_ONLY, ["system"]],
    // A circuit with no parts still has a schematic group, and nothing in it.
    ["a system diagram and an empty schematic", { ...SYSTEM_ONLY, schematic_group: 1 }, ["system"]],
    ["an empty board", { pcb_board: 1 }, ["pcb", "cad"]],
    [
      "parts with no board around them",
      { pcb_group: 1, pcb_component: 2, pcb_smtpad: 4, schematic_component: 2 },
      ["pcb", "bom", "schematic"],
    ],
    // A file with no parts still has a PCB group, and nothing in it.
    ["an empty group", { pcb_group: 1, schematic_group: 1 }, []],
    ["only a PCB error", { pcb_group: 1, pcb_autorouting_error: 1 }, []],
    [
      "a board with a simulation while results are pending",
      { ...BOARD, simulation_experiment: 1 },
      ["pcb", "cad", "bom", "schematic", "analog_simulation"],
    ],
    // The viewer has no schematic for a panel of boards.
    ["a panel", { pcb_panel: 1, pcb_component: 4, schematic_component: 4 }, ["pcb", "cad", "bom"]],
    ["nothing rendered", {}, []],
  ])("%s", (_name, counts, expected) => {
    expect([...viewsWithContent(counts)].toSorted()).toEqual(expected.toSorted());
  });
});

describe("circuitPanelReducer", () => {
  it("moves off a view with nothing in it until the user picks one", () => {
    const picked = run([{ type: "circuit_rendered", counts: SYSTEM_ONLY }]);
    expect(picked.view.screen).toBe("system");

    const noCircuit = run([{ type: "circuit_rendered", counts: {} }]);
    expect(noCircuit.view.screen).toBe("source");

    const userChose = run([
      { type: "user_picked", screen: "schematic" },
      { type: "circuit_rendered", counts: SYSTEM_ONLY },
    ]);
    expect(userChose.view.screen).toBe("schematic");
  });

  it("shows the errors of a failed run and returns when a later run renders", () => {
    const failed = run([
      { type: "files_sent" },
      { type: "run_failed", message: "Unexpected token" },
    ]);
    expect(failed.view).toMatchObject({ screen: "errors", returnTo: "pcb", running: false });
    expect(unmutedViews(failed.view).size).toBe(0);

    // The error stays while the fix is running: the viewer says when it is gone.
    const rerunning = circuitPanelReducer(failed, { type: "files_sent", file: "index.tsx" });
    expect(rerunning.view).toMatchObject({
      screen: "errors",
      executionError: "Unexpected token",
      running: true,
    });

    const fixed = circuitPanelReducer(rerunning, {
      type: "circuit_rendered",
      file: "index.tsx",
      counts: BOARD,
    });
    expect(fixed.view).toMatchObject({ screen: "pcb", executionError: null, returnTo: null });
  });

  it("leaves the source in place when the file fails", () => {
    const state = run([
      { type: "user_picked", screen: "source" },
      { type: "run_failed", message: "Unexpected token" },
    ]);
    expect(state.view).toMatchObject({ screen: "source", executionError: "Unexpected token" });
  });

  it("stays on errors the user opened after the error is gone", () => {
    const state = run([
      { type: "run_failed", message: "Unexpected token" },
      { type: "user_picked", screen: "errors" },
      { type: "circuit_rendered", counts: BOARD },
    ]);
    expect(state.view.screen).toBe("errors");
  });

  it("follows the viewer from one drawn view to another, and nowhere else", () => {
    expect(run([{ type: "tab_requested", tab: "schematic" }]).view.screen).toBe("schematic");
    expect(run([{ type: "tab_requested", tab: "errors" }]).view.screen).toBe("pcb");
    expect(run([{ type: "tab_requested", tab: "circuit_json" }]).view.screen).toBe("pcb");
    expect(run([{ type: "tab_requested", tab: "drawing" }]).view.screen).toBe("pcb");
    const reading = run([
      { type: "user_picked", screen: "source" },
      { type: "tab_requested", tab: "schematic" },
    ]);
    expect(reading.view.screen).toBe("source");
  });

  it("starts another file on the last view the user chose, with nothing carried over", () => {
    const first = run([
      { type: "user_picked", screen: "schematic" },
      { type: "run_failed", message: "Unexpected token" },
      { type: "user_picked", screen: "errors" },
    ]);
    expect(first.preferred).toBe("schematic");
    expect(viewStateForFile(first, "other.tsx")).toMatchObject({
      screen: "schematic",
      executionError: null,
      userPicked: false,
    });
    const second = circuitPanelReducer(first, {
      type: "circuit_rendered",
      file: "other.tsx",
      counts: BOARD,
    });
    expect(second).toMatchObject({ file: "other.tsx", view: { screen: "schematic" } });
  });
});

describe("the Drawings tab", () => {
  const tabIds = (state: CircuitPanelState) => viewTabs(state.view).map((view) => view.id);

  it("is there only for a design that has drawings", () => {
    expect(tabIds(initialCircuitPanelState("pcb"))).not.toContain("drawing");
    expect(tabIds(run([{ type: "circuit_rendered", counts: BOARD }]))).not.toContain("drawing");
    expect(tabIds(run([{ type: "circuit_rendered", counts: WITH_DRAWINGS }]))).toEqual([
      "source",
      "pcb",
      "schematic",
      "cad",
      "system",
      "bom",
      "drawing",
      "analog_simulation",
    ]);
  });

  it("gives way when the drawings are removed, though the user picked it", () => {
    const state = run([
      { type: "circuit_rendered", counts: WITH_DRAWINGS },
      { type: "user_picked", screen: "drawing" },
      { type: "circuit_rendered", counts: BOARD },
    ]);
    expect(state.view.screen).toBe("pcb");
    expect(tabIds(state)).not.toContain("drawing");
  });

  it("is not the view the next file opens on", () => {
    const state = run([
      { type: "user_picked", screen: "schematic" },
      { type: "circuit_rendered", counts: WITH_DRAWINGS },
      { type: "user_picked", screen: "drawing" },
    ]);
    expect(state.view.screen).toBe("drawing");
    expect(state.preferred).toBe("schematic");
  });
});

it("opens on the saved view, unless it is one this version does not offer", () => {
  expect(preferredViewFrom("schematic")).toBe("schematic");
  expect(preferredViewFrom("bom")).toBe("bom");
  expect(preferredViewFrom(null)).toBe("pcb");
  // Saved by a version that had an Assembly tab.
  expect(preferredViewFrom("assembly")).toBe("pcb");
  expect(preferredViewFrom("drawing")).toBe("pcb");
});

describe("unmutedViews", () => {
  it("mutes nothing before the first render, then only the views with nothing in them", () => {
    const { view } = initialCircuitPanelState("pcb");
    expect(unmutedViews(view).size).toBe(7);
    expect(unmutedViews(view).has("analog_simulation")).toBe(true);
    expect([...unmutedViews({ ...view, counts: SYSTEM_ONLY })]).toEqual(["system"]);
  });

  it("keeps Simulation in the header before an experiment exists", () => {
    const { view } = run([{ type: "circuit_rendered", counts: BOARD }]);
    expect(viewTabs(view).map(({ id }) => id)).toContain("analog_simulation");
    expect(unmutedViews(view)).not.toContain("analog_simulation");
  });
});

it("counts error elements, and words the prompts", () => {
  expect(countErrors({ pcb_trace_error: 2, pcb_autorouting_error: 1, pcb_board: 1 })).toBe(3);
  expect(countErrors(null)).toBe(0);
  expect(fixErrorPrompt("lib/a.tsx", "Unexpected token (4:2)\n  at parse")).toBe(
    "Fix this error in lib/a.tsx: Unexpected token (4:2)",
  );
  expect(appendToPrompt("", "Add a board")).toBe("Add a board");
  expect(appendToPrompt("Tidy the layout\n", "Add a board")).toBe("Tidy the layout\n\nAdd a board");
});
