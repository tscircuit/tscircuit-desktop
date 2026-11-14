import { describe, expect, it } from "vite-plus/test";

import {
  appendToPrompt,
  type CircuitPanelState,
  circuitPanelReducer,
  type CircuitViewAction,
  countErrors,
  fixErrorPrompt,
  initialCircuitPanelState,
  unmutedViews,
  viewStateForFile,
  viewsWithContent,
} from "./circuitViews";

const BOARD = { pcb_board: 1, pcb_component: 2, schematic_component: 2, schematic_group: 1 };
const SYSTEM_ONLY = { system_block_page: 1, system_block_component: 2 };

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
    ["a board with parts", BOARD, ["pcb", "cad", "assembly", "schematic"]],
    ["a system diagram on its own", SYSTEM_ONLY, ["system"]],
    // A circuit with no parts still has a schematic group, and nothing in it.
    ["a system diagram and an empty schematic", { ...SYSTEM_ONLY, schematic_group: 1 }, ["system"]],
    ["an empty board", { pcb_board: 1 }, ["pcb", "cad"]],
    // The viewer has no schematic for a panel of boards.
    [
      "a panel",
      { pcb_panel: 1, pcb_component: 4, schematic_component: 4 },
      ["pcb", "cad", "assembly"],
    ],
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
    expect(run([{ type: "tab_requested", tab: "bom" }]).view.screen).toBe("pcb");
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

describe("unmutedViews", () => {
  it("mutes nothing before the first render, then only the views with nothing in them", () => {
    const { view } = initialCircuitPanelState("pcb");
    expect(unmutedViews(view).size).toBe(5);
    expect([...unmutedViews({ ...view, counts: SYSTEM_ONLY })]).toEqual(["system"]);
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
