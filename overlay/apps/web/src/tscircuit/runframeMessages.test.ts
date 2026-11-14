import { describe, expect, it } from "vite-plus/test";

import { parseViewerMessage, viewerFileProps, viewerTabProps } from "./runframeMessages";

describe("parseViewerMessage", () => {
  it("tells a viewer that takes the app's tab from one that keeps its own header", () => {
    expect(
      parseViewerMessage({
        runframe_type: "runframe_ready_to_receive",
        runframe_capabilities: ["show_header", "active_tab", "render_events"],
      }),
    ).toEqual({ kind: "ready", hostControlled: true });
    expect(parseViewerMessage({ runframe_type: "runframe_ready_to_receive" })).toEqual({
      kind: "ready",
      hostControlled: false,
    });
    expect(
      parseViewerMessage({
        runframe_type: "runframe_ready_to_receive",
        runframe_capabilities: ["render_events"],
      }),
    ).toEqual({ kind: "ready", hostControlled: false });
  });

  it("reads events in both envelopes the viewer has used", () => {
    expect(
      parseViewerMessage({
        type: "runframe_event",
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
  it("names the tab for a viewer that takes it, and limits one that does not to that tab", () => {
    expect(viewerTabProps("cad", true)).toEqual({ activeTab: "cad" });
    expect(viewerTabProps("cad", false)).toEqual({
      defaultActiveTab: "cad",
      availableTabs: ["cad"],
    });
    // The source is drawn by the app, so the viewer keeps whatever it shows.
    expect(viewerTabProps("source", true)).toEqual({});
  });

  it("sends files with the header off and a tab, also while the source is on screen", () => {
    expect(
      viewerFileProps({
        fsMap: { "index.tsx": "x" },
        mainComponentPath: "index.tsx",
        screen: "source",
        hostControlled: true,
      }),
    ).toMatchObject({
      fsMap: { "index.tsx": "x" },
      mainComponentPath: "index.tsx",
      showHeader: false,
      activeTab: "pcb",
    });
  });
});
