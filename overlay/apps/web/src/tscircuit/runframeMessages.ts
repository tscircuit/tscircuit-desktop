import type { CircuitScreen, ElementCounts } from "./circuitViews";

/** What the viewer frame tells the app. Null for a message that is not one of these. */
export type ViewerMessage =
  /** The frame's own script, before RunFrame starts: where the bundled eval worker is. */
  | { readonly kind: "assets_ready"; readonly evalWebWorkerBlobUrl: string | null }
  | { readonly kind: "ready" }
  | { readonly kind: "run_started" }
  | { readonly kind: "circuit_rendered"; readonly counts: ElementCounts }
  | { readonly kind: "run_completed"; readonly failed: boolean }
  | { readonly kind: "run_failed"; readonly message: string }
  | { readonly kind: "tab_requested"; readonly tab: string };

/** What the app's header needs of RunFrame. `setup` checks the bundled copy has them. */
const REQUIRED_CAPABILITIES = ["show_header", "active_tab", "render_events"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readCounts(value: unknown): ElementCounts {
  const counts: Record<string, number> = {};
  if (!isRecord(value)) return counts;
  for (const [type, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isFinite(count)) counts[type] = count;
  }
  return counts;
}

export function parseViewerMessage(data: unknown): ViewerMessage | null {
  if (!isRecord(data)) return null;
  if (data.tscircuit_viewer_type === "assets_ready") {
    const url = data.evalWebWorkerBlobUrl;
    return {
      kind: "assets_ready",
      evalWebWorkerBlobUrl: typeof url === "string" && url.startsWith("blob:") ? url : null,
    };
  }
  if (data.runframe_type === "runframe_ready_to_receive") {
    const capabilities = Array.isArray(data.runframe_capabilities)
      ? data.runframe_capabilities
      : [];
    return REQUIRED_CAPABILITIES.every((name) => capabilities.includes(name))
      ? { kind: "ready" }
      : null;
  }
  if (data.runframe_type !== "runframe_event") return null;
  const event = data.runframe_event;
  if (!isRecord(event)) return null;
  switch (event.type) {
    case "render_started":
      return { kind: "run_started" };
    case "circuit_json_changed":
    case "render_finished":
      return { kind: "circuit_rendered", counts: readCounts(event.circuit_json_element_counts) };
    case "run_completed":
      return { kind: "run_completed", failed: event.has_execution_error === true };
    case "error":
      return {
        kind: "run_failed",
        message: typeof event.error_message === "string" ? event.error_message : "Unknown error",
      };
    case "active_tab_changed":
      return typeof event.tab === "string" ? { kind: "tab_requested", tab: event.tab } : null;
    default:
      return null;
  }
}

/** The viewer's own tab for a screen. Source is drawn by the app, over whatever tab is behind it. */
const viewerTab = (screen: CircuitScreen): string | null => (screen === "source" ? null : screen);

/** The props that put `screen` on the viewer. */
export function viewerTabProps(screen: CircuitScreen): Record<string, unknown> {
  const tab = viewerTab(screen);
  return tab === null ? {} : { activeTab: tab };
}

/** Everything the viewer needs to render a file. Tab-only changes send `viewerTabProps` alone. */
export function viewerFileProps(input: {
  readonly fsMap: Record<string, string>;
  readonly mainComponentPath: string;
  readonly screen: CircuitScreen;
  /** The bundled eval worker. Without it RunFrame downloads one from a CDN. */
  readonly evalWebWorkerBlobUrl: string | null;
}): Record<string, unknown> {
  return {
    fsMap: input.fsMap,
    mainComponentPath: input.mainComponentPath,
    ...(input.evalWebWorkerBlobUrl === null
      ? {}
      : { evalWebWorkerBlobUrl: input.evalWebWorkerBlobUrl }),
    showHeader: false,
    showRunButton: false,
    showFileMenu: false,
    showToggleFullScreen: false,
    // Source has no tab in the viewer, so it waits on the board behind the source.
    ...viewerTabProps(input.screen === "source" ? "pcb" : input.screen),
  };
}
