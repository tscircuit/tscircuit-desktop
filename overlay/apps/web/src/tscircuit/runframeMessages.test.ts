import { describe, expect, it } from "vite-plus/test";

import { parseViewerMessage, viewerFileProps, viewerTabProps } from "./runframeMessages";

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

  it("sends files with the header off and a tab, also while the source is on screen", () => {
    const files = { fsMap: { "index.tsx": "x" }, mainComponentPath: "index.tsx" };
    expect(viewerFileProps({ ...files, screen: "source" })).toMatchObject({
      ...files,
      showHeader: false,
      // Source has no tab in the viewer, so the board waits behind it.
      activeTab: "pcb",
    });
  });
});
