/**
 * tscircuit desktop: the views in the Circuit tab's header, which of them a
 * file has something to show in, and which one is on screen.
 */

/** A view the viewer draws from the circuit. */
export type RenderedViewId =
  | "pcb"
  | "schematic"
  | "cad"
  | "system"
  | "bom"
  | "drawing"
  | "analog_simulation";
/** A view with a tab of its own. Source is the file's text, drawn by the app. */
export type CircuitViewId = "source" | RenderedViewId;
/** What can be on screen: a view, or the viewer's list of errors. */
export type CircuitScreen = CircuitViewId | "errors";

const CIRCUIT_VIEWS: ReadonlyArray<{ readonly id: CircuitViewId; readonly label: string }> = [
  { id: "source", label: "Source" },
  { id: "pcb", label: "PCB" },
  { id: "schematic", label: "Schematic" },
  { id: "cad", label: "3D" },
  { id: "system", label: "System" },
  { id: "bom", label: "BOM" },
  { id: "drawing", label: "Drawings" },
  { id: "analog_simulation", label: "Simulation" },
];

const RENDERED_VIEWS: ReadonlyArray<RenderedViewId> = [
  "pcb",
  "schematic",
  "cad",
  "system",
  "bom",
  "drawing",
  "analog_simulation",
];

/** Few designs have drawings, so this view has a tab only in one that does. */
const TAB_ONLY_WITH_CONTENT: RenderedViewId = "drawing";
/** A view with a tab in every file: muted, with help on how to fill it, while it is empty. */
export type StandingViewId = Exclude<RenderedViewId, "drawing">;

export const hasStandingTab = (view: RenderedViewId): view is StandingViewId =>
  view !== TAB_ONLY_WITH_CONTENT;

const DEFAULT_CIRCUIT_VIEW: CircuitViewId = "pcb";

/** The view the next file opens on. Not one that most files have no tab for. */
export const canBePreferred = (screen: CircuitScreen): screen is CircuitViewId =>
  screen !== "errors" && screen !== TAB_ONLY_WITH_CONTENT;

/** The view a saved choice names. An older version may have saved one that is gone. */
export const preferredViewFrom = (saved: string | null): CircuitViewId =>
  CIRCUIT_VIEWS.find((view) => view.id === saved && canBePreferred(view.id))?.id ??
  DEFAULT_CIRCUIT_VIEW;

const isRenderedView = (screen: CircuitScreen): screen is RenderedViewId =>
  (RENDERED_VIEWS as ReadonlyArray<string>).includes(screen);

/** How many elements of each type the rendered circuit has, as the viewer reports it. */
export type ElementCounts = Readonly<Record<string, number>>;

const has = (counts: ElementCounts, type: string) => (counts[type] ?? 0) > 0;

/** Containers: a file with no parts still has them, and nothing to draw in them. */
const CONTAINERS = new Set(["pcb_group", "schematic_group", "schematic_sheet"]);

const hasContent = (counts: ElementCounts, prefix: "pcb_" | "schematic_" | "drawing_") =>
  Object.entries(counts).some(
    ([type, count]) =>
      count > 0 &&
      type.startsWith(prefix) &&
      !type.includes("error") &&
      !type.includes("warning") &&
      !CONTAINERS.has(type),
  );

/** The rendered views a circuit has something to show in. */
export function viewsWithContent(counts: ElementCounts): ReadonlySet<RenderedViewId> {
  const views = new Set<RenderedViewId>();
  const board = has(counts, "pcb_board") || has(counts, "pcb_panel");
  // Parts draw without a board around them: a file that is one module has none.
  if (hasContent(counts, "pcb_")) views.add("pcb");
  if (board) views.add("cad");
  // The bill of materials has a row for each part that is placed.
  if (has(counts, "pcb_component")) views.add("bom");
  if (hasContent(counts, "drawing_")) views.add("drawing");
  // The viewer cannot draw one schematic for a panel of boards.
  if (hasContent(counts, "schematic_") && !has(counts, "pcb_panel")) views.add("schematic");
  if (has(counts, "system_block_page")) views.add("system");
  if (has(counts, "simulation_experiment")) views.add("analog_simulation");
  return views;
}

/** Errors and warnings are element types of their own in a circuit's output. */
export function countErrors(counts: ElementCounts | null): number {
  if (counts === null) return 0;
  let total = 0;
  for (const [type, count] of Object.entries(counts)) {
    if (type.includes("error")) total += count;
  }
  return total;
}

export interface CircuitViewState {
  readonly screen: CircuitScreen;
  /** Where to go back to once a failed run renders again. */
  readonly returnTo: RenderedViewId | null;
  /** The user chose the screen for this file, so it is not picked for them. */
  readonly userPicked: boolean;
  /** Null until the viewer has reported a render of this file. */
  readonly counts: ElementCounts | null;
  /** The message of a run that threw before it rendered anything. */
  readonly executionError: string | null;
  readonly running: boolean;
  /** Runs of this file that have ended, which tells one rendered circuit from the next. */
  readonly completedRuns: number;
}

export type CircuitViewAction =
  | { readonly type: "user_picked"; readonly screen: CircuitScreen }
  /** The viewer asks for one of its tabs, as "view in schematic" on a PCB part does. */
  | { readonly type: "tab_requested"; readonly tab: string }
  /** New file contents went to the viewer, which runs them and says how it went. */
  | { readonly type: "files_sent" }
  | { readonly type: "run_started" }
  | { readonly type: "circuit_rendered"; readonly counts: ElementCounts }
  | { readonly type: "run_completed"; readonly failed: boolean }
  | { readonly type: "run_failed"; readonly message: string };

const initialCircuitViewState = (preferred: CircuitViewId): CircuitViewState => ({
  screen: preferred,
  returnTo: null,
  userPicked: false,
  counts: null,
  executionError: null,
  running: false,
  completedRuns: 0,
});

/** Leaves the errors screen it was sent to, once there is no error to show. */
function withErrorCleared(state: CircuitViewState): CircuitViewState {
  const next = { ...state, executionError: null };
  return state.screen === "errors" && state.returnTo !== null
    ? { ...next, screen: state.returnTo, returnTo: null }
    : next;
}

/**
 * Until the user picks a view for this file, a view with nothing in it gives
 * way to the first one that has something, or to the source. A view whose tab
 * is gone gives way even if the user picked it.
 */
function withViewPicked(state: CircuitViewState): CircuitViewState {
  if (state.counts === null || !isRenderedView(state.screen)) return state;
  if (state.userPicked && state.screen !== TAB_ONLY_WITH_CONTENT) return state;
  const available = viewsWithContent(state.counts);
  if (available.has(state.screen)) return state;
  return { ...state, screen: RENDERED_VIEWS.find((view) => available.has(view)) ?? "source" };
}

function circuitViewReducer(state: CircuitViewState, action: CircuitViewAction): CircuitViewState {
  switch (action.type) {
    case "user_picked":
      return { ...state, screen: action.screen, returnTo: null, userPicked: true };
    case "tab_requested": {
      // Only from one drawn view to another. The app decides about errors and the source itself.
      const requested = viewTabs(state).find((view) => view.id === action.tab)?.id;
      return requested !== undefined && requested !== "source" && isRenderedView(state.screen)
        ? { ...state, screen: requested, returnTo: null, userPicked: true }
        : state;
    }
    case "files_sent":
      return { ...state, running: true };
    case "run_started":
      return { ...state, running: true };
    case "circuit_rendered":
      return withViewPicked(withErrorCleared({ ...state, counts: action.counts }));
    case "run_completed": {
      const ended = { ...state, running: false, completedRuns: state.completedRuns + 1 };
      return action.failed ? ended : withErrorCleared(ended);
    }
    case "run_failed": {
      const failed = {
        ...state,
        running: false,
        counts: null,
        executionError: action.message,
      };
      // The source stays put: someone reading a file is not sent to its errors.
      return isRenderedView(state.screen)
        ? { ...failed, screen: "errors" as const, returnTo: state.screen }
        : failed;
    }
  }
}

/** The view state of the file on screen. Another file starts over, on the preferred view. */
export interface CircuitPanelState {
  readonly file: string | null;
  readonly view: CircuitViewState;
  /** The view the user last chose, which the next file opens on. */
  readonly preferred: CircuitViewId;
}

export const initialCircuitPanelState = (preferred: CircuitViewId): CircuitPanelState => ({
  file: null,
  view: initialCircuitViewState(preferred),
  preferred,
});

export const viewStateForFile = (
  state: CircuitPanelState,
  file: string | null,
): CircuitViewState =>
  state.file === file ? state.view : initialCircuitViewState(state.preferred);

export function circuitPanelReducer(
  state: CircuitPanelState,
  action: CircuitViewAction & { readonly file: string },
): CircuitPanelState {
  const preferred =
    action.type === "user_picked" && canBePreferred(action.screen)
      ? action.screen
      : state.preferred;
  return {
    file: action.file,
    view: circuitViewReducer(viewStateForFile(state, action.file), action),
    preferred,
  };
}

/**
 * The rendered views that are not muted in the header. None is muted before
 * the first render, which is about to say which ones have something to show.
 */
export function unmutedViews(state: CircuitViewState): ReadonlySet<RenderedViewId> {
  if (state.executionError !== null) return new Set();
  return state.counts === null ? new Set(RENDERED_VIEWS) : viewsWithContent(state.counts);
}

/** The views with a tab in the header, in order. */
export function viewTabs(state: CircuitViewState): typeof CIRCUIT_VIEWS {
  const shown = state.counts !== null && viewsWithContent(state.counts).has(TAB_ONLY_WITH_CONTENT);
  return shown ? CIRCUIT_VIEWS : CIRCUIT_VIEWS.filter((view) => view.id !== TAB_ONLY_WITH_CONTENT);
}

export interface ViewHelp {
  readonly title: string;
  readonly description: string;
  /** A short file that makes the view work. */
  readonly example: string;
  /** What "Add to prompt" asks the agent for. */
  readonly prompt: string;
}

const BOARD_EXAMPLE = `export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0402" />
    <capacitor name="C1" capacitance="100nF" footprint="0402" />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />
  </board>
)`;

export const VIEW_HELP: Readonly<Record<StandingViewId, ViewHelp>> = {
  pcb: {
    title: "This file has nothing to place on a PCB",
    description:
      "The PCB view draws the footprints of the parts in the file, and the <board> around them if there is one. Add parts and give each one a footprint.",
    example: BOARD_EXAMPLE,
    prompt: "Add TSX parts with footprints to populate the PCB view",
  },
  schematic: {
    title: "This file has no schematic",
    description:
      "The Schematic view draws the parts in the file and the traces between them. Add parts such as <resistor> or <chip> and connect them with <trace>.",
    example: BOARD_EXAMPLE,
    prompt: "Add TSX parts and traces to populate the Schematic view",
  },
  cad: {
    title: "This file has no board to show in 3D",
    description:
      "The 3D view builds a model from a <board> and the footprints of the parts on it. Wrap your parts in a board and give each one a footprint.",
    example: BOARD_EXAMPLE,
    prompt: "Add a TSX <board> with parts and footprints to populate the 3D view",
  },
  system: {
    title: "This file has no system diagram",
    description:
      "The System view is a block diagram of what the circuit does. Add a <systemblock.page> with a block for each function and the connections between them. It can stand alone or sit inside a board.",
    example: `import { systemblock } from "tscircuit"

export default () => (
  <systemblock.page name="overview">
    <systemblock.component name="sensor" />
    <systemblock.component name="mcu" />
    <systemblock.connection from="sensor" to="mcu" label="I2C" />
  </systemblock.page>
)`,
    prompt: "Add TSX systemblock elements to populate the System view",
  },
  bom: {
    title: "This file has no parts to list",
    description:
      "The BOM view lists the parts to buy: one row for each part that is placed, with its value and footprint. Add parts and give each one a footprint.",
    example: BOARD_EXAMPLE,
    prompt: "Add TSX parts with footprints to populate the BOM view",
  },
  analog_simulation: {
    title: "This file has no analog simulation",
    description: "Add an analog simulation, a source, and a probe to see the results here.",
    example: `export default () => (
  <board routingDisabled>
    <voltagesource name="V1" voltage="5V" />
    <resistor name="R1" resistance="1k" />
    <trace from=".V1 > .pin1" to=".R1 > .pin1" />
    <trace from=".V1 > .pin2" to=".R1 > .pin2" />
    <voltageprobe name="VP1" connectsTo=".R1 > .pin1" />
    <analogsimulation duration="10ms" timePerStep="100us" />
  </board>
)`,
    prompt:
      "Add SPICE sources, probes, and an analog simulation to this circuit so I can open it in the Simulation view",
  },
};

/** What "Add to prompt" asks for when the file threw before it rendered. */
export const fixErrorPrompt = (relativePath: string, message: string): string =>
  `Fix this error in ${relativePath}: ${message.trim().split("\n")[0] ?? ""}`;

/** Adds a request to a prompt that may already hold a draft. */
export const appendToPrompt = (existing: string, addition: string): string =>
  existing.trim().length === 0 ? addition : `${existing.replace(/\s+$/, "")}\n\n${addition}`;
