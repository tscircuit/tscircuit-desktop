import { type CircuitPreviewEvent, parseCircuitPreviewEvent } from "./circuitPlayback";
import { type AutorouterPhase, readAutorouterPhases } from "./autorouterPhases";
import type { CircuitScreen, ElementCounts } from "./circuitViews";

/** What the viewer frame tells the app. Null for a message that is not one of these. */
export type ViewerMessage =
  | { readonly kind: "circuit_preview_event"; readonly event: CircuitPreviewEvent }
  | { readonly kind: "ready" }
  | { readonly kind: "run_started" }
  | { readonly kind: "circuit_rendered"; readonly counts: ElementCounts }
  | { readonly kind: "run_completed"; readonly failed: boolean }
  | { readonly kind: "run_failed"; readonly message: string }
  | { readonly kind: "tab_requested"; readonly tab: string }
  /** The autorouting phases of the run so far. Empty when a run starts. */
  | { readonly kind: "autorouter_phases"; readonly phases: ReadonlyArray<AutorouterPhase> }
  /** The answer to `phaseInputRequest`: what the autorouter was given, or null if it is gone. */
  | {
      readonly kind: "autorouter_phase_input";
      readonly requestId: string;
      readonly simpleRouteJson: unknown;
    };

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

/** RunFrame says nothing of autorouting to the page around it. These come from frame.html itself. */
function parseFrameMessage(data: Record<string, unknown>): ViewerMessage | null {
  switch (data.tscircuit_desktop_type) {
    case "circuit_preview_event": {
      const event = parseCircuitPreviewEvent(data.event);
      return event === null ? null : { kind: "circuit_preview_event", event };
    }
    case "autorouter_phases":
      return { kind: "autorouter_phases", phases: readAutorouterPhases(data.phases) };
    case "autorouter_phase_input":
      return typeof data.request_id === "string"
        ? {
            kind: "autorouter_phase_input",
            requestId: data.request_id,
            simpleRouteJson: data.simple_route_json ?? null,
          }
        : null;
    default:
      return null;
  }
}

/** Asks the frame for the Simple Route JSON a phase of the last run started from. */
export const phaseInputRequest = (requestId: string, phaseId: string) => ({
  tscircuit_desktop_type: "get_autorouter_phase_input",
  request_id: requestId,
  phase_id: phaseId,
});

export function parseViewerMessage(data: unknown): ViewerMessage | null {
  if (!isRecord(data)) return null;
  if (data.tscircuit_desktop_type !== undefined) return parseFrameMessage(data);
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

const REBUILD_MARKER_FILE = ".tscircuit-desktop/rebuild";

/** Everything the viewer needs to render a file. Tab-only changes send `viewerTabProps` alone. */
export function viewerFileProps(input: {
  readonly fsMap: Record<string, string>;
  readonly mainComponentPath: string;
  readonly screen: CircuitScreen;
  /** How many times the user asked for the same files to be built again. */
  readonly rebuilds: number;
}): Record<string, unknown> {
  return {
    // RunFrame runs again only when a file changed, so a rebuild changes one that no circuit reads.
    fsMap:
      input.rebuilds === 0
        ? input.fsMap
        : { ...input.fsMap, [REBUILD_MARKER_FILE]: String(input.rebuilds) },
    mainComponentPath: input.mainComponentPath,
    showHeader: false,
    showRunButton: false,
    showFileMenu: false,
    showToggleFullScreen: false,
    hideSchematicInAnalogSimulation: true,
    // Source has no tab in the viewer, so it waits on the board behind the source.
    ...viewerTabProps(input.screen === "source" ? "pcb" : input.screen),
  };
}
