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

  it("takes the bundled eval worker's address, and only a blob's", () => {
    expect(
      parseViewerMessage({
        tscircuit_viewer_type: "assets_ready",
        evalWebWorkerBlobUrl: "blob:null/1b9d6bcd",
      }),
    ).toEqual({ kind: "assets_ready", evalWebWorkerBlobUrl: "blob:null/1b9d6bcd" });
    for (const evalWebWorkerBlobUrl of [null, 7, "https://example.com/worker.js"]) {
      expect(
        parseViewerMessage({ tscircuit_viewer_type: "assets_ready", evalWebWorkerBlobUrl }),
      ).toEqual({ kind: "assets_ready", evalWebWorkerBlobUrl: null });
    }
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

  it("sends files with the header off, a tab, and the bundled worker when there is one", () => {
    const files = { fsMap: { "index.tsx": "x" }, mainComponentPath: "index.tsx" };
    const props = viewerFileProps({
      ...files,
      screen: "source",
      evalWebWorkerBlobUrl: "blob:null/1b9d6bcd",
    });
    expect(props).toMatchObject({
      ...files,
      showHeader: false,
      // Source has no tab in the viewer, so the board waits behind it.
      activeTab: "pcb",
      evalWebWorkerBlobUrl: "blob:null/1b9d6bcd",
    });
    expect(
      viewerFileProps({ ...files, screen: "cad", evalWebWorkerBlobUrl: null }),
    ).not.toHaveProperty("evalWebWorkerBlobUrl");
  });
});
