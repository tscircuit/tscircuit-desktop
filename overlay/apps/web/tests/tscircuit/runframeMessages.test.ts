import { describe, expect, it } from "vite-plus/test";

import {
  parseViewerMessage,
  phaseInputRequest,
  viewerFileProps,
  viewerTabProps,
} from "../../src/tscircuit/runframeMessages";

describe("parseViewerMessage", () => {
  it("is ready only for a RunFrame that takes the app's tab and reports its renders", () => {
    expect(
      parseViewerMessage({
        runframe_type: "runframe_ready_to_receive",
        runframe_capabilities: ["show_header", "active_tab", "render_events"],
      }),
    ).toEqual({ kind: "ready" });
    expect(parseViewerMessage({ runframe_type: "runframe_ready_to_receive" })).toBeNull();
    expect(
      parseViewerMessage({
        runframe_type: "runframe_ready_to_receive",
        runframe_capabilities: ["render_events"],
      }),
    ).toBeNull();
  });

  it("reads the viewer's events", () => {
    expect(
      parseViewerMessage({
        runframe_type: "runframe_event",
        runframe_event: { type: "error", error_message: "Unexpected token" },
      }),
    ).toEqual({ kind: "run_failed", message: "Unexpected token" });
    expect(
      parseViewerMessage({
        runframe_type: "runframe_event",
        runframe_event: {
          type: "circuit_json_changed",
          circuit_json_element_counts: { pcb_board: 1, bogus: "2" },
        },
      }),
    ).toEqual({ kind: "circuit_rendered", counts: { pcb_board: 1 } });
    expect(
      parseViewerMessage({
        runframe_type: "runframe_event",
        runframe_event: { type: "run_completed", has_execution_error: true, error_count: 0 },
      }),
    ).toEqual({ kind: "run_completed", failed: true });
    expect(
      parseViewerMessage({
        runframe_type: "runframe_event",
        runframe_event: { type: "active_tab_changed", tab: "schematic" },
      }),
    ).toEqual({ kind: "tab_requested", tab: "schematic" });
  });

  it("reads what the frame says of the run's autorouting", () => {
    expect(
      parseViewerMessage({
        tscircuit_desktop_type: "autorouter_phases",
        phases: [{ id: "run1-phase1", status: "running", connectionCount: 2 }, "junk"],
      }),
    ).toEqual({
      kind: "autorouter_phases",
      phases: [{ id: "run1-phase1", status: "running", connectionCount: 2 }],
    });
    expect(
      parseViewerMessage({
        tscircuit_desktop_type: "autorouter_phase_input",
        request_id: "7",
        simple_route_json: { layerCount: 2 },
      }),
    ).toEqual({
      kind: "autorouter_phase_input",
      requestId: "7",
      simpleRouteJson: { layerCount: 2 },
    });
    // The frame no longer has a phase of an earlier run.
    expect(
      parseViewerMessage({ tscircuit_desktop_type: "autorouter_phase_input", request_id: "8" }),
    ).toEqual({ kind: "autorouter_phase_input", requestId: "8", simpleRouteJson: null });
    expect(phaseInputRequest("7", "run1-phase1")).toEqual({
      tscircuit_desktop_type: "get_autorouter_phase_input",
      request_id: "7",
      phase_id: "run1-phase1",
    });
  });

  it.each([null, "ready", [], {}, { runframe_type: "runframe_event" }, { type: "other" }])(
    "ignores %j",
    (data) => {
      expect(parseViewerMessage(data)).toBeNull();
    },
  );
});

describe("viewer props", () => {
  it("names the viewer's tab", () => {
    expect(viewerTabProps("cad")).toEqual({ activeTab: "cad" });
    // The source is drawn by the app, so the viewer keeps whatever it shows.
    expect(viewerTabProps("source")).toEqual({});
  });

  it("sends the preview options and a tab even while the source is on screen", () => {
    const files = { fsMap: { "index.tsx": "x" }, mainComponentPath: "index.tsx" };
    expect(viewerFileProps({ ...files, screen: "source", rebuilds: 0 })).toMatchObject({
      ...files,
      showHeader: false,
      hideSchematicInAnalogSimulation: true,
      // Source has no tab in the viewer, so the board waits behind it.
      activeTab: "pcb",
    });
  });

  it("changes a file no circuit reads to build the same files again", () => {
    const files = { fsMap: { "index.tsx": "x" }, mainComponentPath: "index.tsx" };
    const build = (rebuilds: number) =>
      viewerFileProps({ ...files, screen: "pcb", rebuilds }).fsMap as Record<string, string>;
    expect(build(0)).toBe(files.fsMap);
    expect(build(1)).toMatchObject(files.fsMap);
    expect(build(1)).not.toEqual(build(0));
    expect(build(2)).not.toEqual(build(1));
  });
});
