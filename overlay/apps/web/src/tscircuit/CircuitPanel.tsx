import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ShoppingCart } from "lucide-react";
import {
  type Dispatch,
  type RefObject,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
} from "react";

import { ReadOnlySourcePreview } from "~/components/files/AttachmentFilePreview";
import { FILE_SURFACE_SUBHEADER_CLASS } from "~/components/files/fileSurfaceChrome";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";

import { expectedBuild, isBuildOfSources } from "./builtCircuit";
import type { AutorouterPhase } from "./autorouterPhases";
import { AutorouterReportDialog } from "./AutorouterReportDialog";
import { useAutorouterReportRequest } from "./autorouterReportRequest";
import { type CircuitViewHelp, CircuitViewHelpDialog } from "./CircuitViewHelpDialog";
import {
  appendToPrompt,
  canBePreferred,
  type CircuitPanelState,
  circuitPanelReducer,
  type CircuitScreen,
  type CircuitViewAction,
  countErrors,
  fixErrorPrompt,
  hasStandingTab,
  initialCircuitPanelState,
  preferredViewFrom,
  type RenderedViewId,
  type StandingViewId,
  unmutedViews,
  VIEW_HELP,
  viewStateForFile,
  viewTabs,
} from "./circuitViews";
import { openOrderPane } from "./orderActions";
import {
  type LoadedProject,
  loadProjectFsMap,
  pickEntryFile,
  type ProjectFsMap,
  readBuiltCircuitJson,
} from "./projectFsMap";
import {
  isViewerCloseRequest,
  parseViewerMessage,
  phaseInputRequest,
  viewerFileProps,
  viewerTabProps,
} from "./runframeMessages";
import { viewerFrame } from "./viewerFrame";

/**
 * The app's own copy of RunFrame, a bare viewer that takes files over
 * postMessage. `setup` bundles it from the tscircuit package (viewer.json).
 */
const VIEWER_FRAME = viewerFrame({
  desktop: isElectron,
  protocol: window.location.protocol,
  baseUrl: import.meta.env.BASE_URL,
});
const VIEWER_LOAD_TIMEOUT_MS = 30_000;
/** The viewer answers from memory, so one that has not answered by now will not. */
const PHASE_INPUT_TIMEOUT_MS = 10_000;
const REFRESH_INTERVAL_MS = 3_000;
/** Larger projects refresh on focus and after agent work, not on a timer. */
const MAX_FILES_TO_POLL = 40;
const PREFERRED_VIEW_STORAGE_KEY = "tscircuit-desktop:circuit-view";

type PanelAction = CircuitViewAction & { readonly file: string };

/**
 * The autorouting phases of the viewer's run of a file's sources. Showing a build
 * runs nothing, so there are none until the sources are run.
 */
interface FilePhases {
  readonly file: string;
  readonly phases: ReadonlyArray<AutorouterPhase>;
}

let phaseInputRequestCount = 0;

/**
 * Asks the viewer frame for the Simple Route JSON a phase of its last run
 * started from. Null when the viewer has none, or does not answer.
 */
function loadPhaseInput(frame: HTMLIFrameElement | null, phaseId: string): Promise<unknown> {
  const viewer = frame?.contentWindow;
  if (!viewer) return Promise.resolve(null);
  phaseInputRequestCount += 1;
  const requestId = String(phaseInputRequestCount);
  return new Promise((resolve) => {
    const finish = (simpleRouteJson: unknown) => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
      resolve(simpleRouteJson);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== viewer) return;
      const message = parseViewerMessage(event.data);
      if (message?.kind === "autorouter_phase_input" && message.requestId === requestId) {
        finish(message.simpleRouteJson);
      }
    };
    const timeout = window.setTimeout(() => finish(null), PHASE_INPUT_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    viewer.postMessage(phaseInputRequest(requestId, phaseId), VIEWER_FRAME.targetOrigin);
  });
}

type ProjectState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly project: LoadedProject;
      /** The workspace mutation this read was made for. */
      readonly revision: string | null;
    }
  | { readonly status: "failed" };

function sameFiles(a: ProjectFsMap | null, b: ProjectFsMap | null): boolean {
  if (a === null || b === null) return a === b;
  const paths = Object.keys(a);
  return paths.length === Object.keys(b).length && paths.every((path) => a[path] === b[path]);
}

/** Files that did not change keep their identity, so the viewer is not asked to render again. */
export function keepUnchangedFiles(current: LoadedProject, loaded: LoadedProject): LoadedProject {
  const fsMap = sameFiles(current.fsMap, loaded.fsMap) ? current.fsMap : loaded.fsMap;
  const hashedFiles = sameFiles(current.hashedFiles, loaded.hashedFiles)
    ? current.hashedFiles
    : loaded.hashedFiles;
  return fsMap === current.fsMap &&
    hashedFiles === current.hashedFiles &&
    loaded.truncated === current.truncated
    ? current
    : { fsMap, hashedFiles, truncated: loaded.truncated };
}

/** What the viewer is given to draw: a file to run, or a build's Circuit JSON to show as it is. */
interface ViewerFiles {
  readonly fsMap: ProjectFsMap;
  readonly mainComponentPath: string;
}

type BuiltCircuit =
  | { readonly status: "checking" }
  | { readonly status: "none" }
  | { readonly status: "current"; readonly files: ViewerFiles };

/**
 * The `tsci build` output of the file on screen, while it is a build of the sources as they
 * are now. A build that is missing or out of date is looked for again after agent work and
 * on focus. One that is current is kept: the same sources build the same circuit.
 */
export function useBuiltCircuit(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly visible: boolean;
  readonly workspaceMutationId: string | null;
  /** Where the build would be and the hash it has to carry, or null when either is unknown. */
  readonly build: { readonly path: string; readonly sourceHash: string } | null;
}): BuiltCircuit {
  const { environmentId, cwd, visible, workspaceMutationId } = input;
  const path = input.build?.path ?? null;
  const sourceHash = input.build?.sourceHash ?? null;
  const [found, setFound] = useState<{
    readonly path: string;
    readonly sourceHash: string;
    /** The workspace mutation this look was made for. */
    readonly revision: string | null;
    readonly files: ViewerFiles | null;
  } | null>(null);
  const answer = found !== null && found.path === path && found.sourceHash === sourceHash;
  const settled = answer && found.files !== null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the build's file from the environment; looks again after agent work and on focus, when a build may have been made
  useEffect(() => {
    if (!cwd || !visible || path === null || sourceHash === null || settled) return;
    const abort = new AbortController();
    let reading = false;
    const look = () => {
      if (reading) return;
      reading = true;
      readBuiltCircuitJson(environmentId, cwd, path, abort.signal)
        .catch(() => null)
        .then((text) => {
          if (abort.signal.aborted) return;
          setFound({
            path,
            sourceHash,
            revision: workspaceMutationId,
            files:
              text !== null && isBuildOfSources(text, sourceHash)
                ? { fsMap: { [path]: text }, mainComponentPath: path }
                : null,
          });
        })
        .finally(() => {
          reading = false;
        });
    };
    look();
    window.addEventListener("focus", look);
    return () => {
      abort.abort();
      window.removeEventListener("focus", look);
    };
  }, [environmentId, cwd, visible, workspaceMutationId, path, sourceHash, settled]);

  if (path === null || sourceHash === null) return { status: "none" };
  if (!answer) return { status: "checking" };
  return found.files === null ? { status: "none" } : { status: "current", files: found.files };
}

export default function CircuitPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  /** The file the user opened, or null to render the project's entry file. */
  readonly relativePath: string | null;
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly workspaceMutationId: string | null;
  /** The composer that "Add to prompt" writes to. */
  readonly composerDraftTarget: ComposerThreadTarget;
  /** The thread whose panel this tab is in, where its Order button opens the Order tab. */
  readonly threadRef: ScopedThreadRef;
}) {
  const { environmentId, cwd, relativePath, visible, workspaceMutationId } = props;
  const [viewerAttempt, setViewerAttempt] = useState(0);
  const [panelState, dispatch] = useReducer(
    circuitPanelReducer,
    preferredViewFrom(getLocalStorageItem(PREFERRED_VIEW_STORAGE_KEY, Schema.String)),
    initialCircuitPanelState,
  );
  const [helpFor, setHelpFor] = useState<StandingViewId | null>(null);
  const [projectState, setProjectState] = useState<ProjectState>({ status: "loading" });
  const [filePhases, setFilePhases] = useState<FilePhases | null>(null);
  const [rebuilds, setRebuilds] = useState(0);
  const [viewerFailed, setViewerFailed] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const reporting = useAutorouterReportRequest((request) => request.requested) && visible;

  const project = projectState.status === "ready" ? projectState.project : null;
  const pollForEdits = project === null || Object.keys(project.fsMap).length <= MAX_FILES_TO_POLL;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the project's files from the environment; refetches after agent work, on focus, and on a timer for small projects
  useEffect(() => {
    if (!cwd || !visible) return;
    const abort = new AbortController();
    let loading = false;
    const load = () => {
      if (loading) return;
      loading = true;
      loadProjectFsMap(environmentId, cwd, abort.signal)
        .then((loaded) => {
          if (abort.signal.aborted) return;
          setProjectState((current) => {
            const project =
              current.status === "ready" ? keepUnchangedFiles(current.project, loaded) : loaded;
            return current.status === "ready" &&
              current.project === project &&
              current.revision === workspaceMutationId
              ? current
              : { status: "ready", project, revision: workspaceMutationId };
          });
        })
        .catch(() => {
          if (abort.signal.aborted) return;
          // A failed refresh keeps the last good read instead of blanking the board.
          setProjectState((current) =>
            current.status === "ready" ? current : { status: "failed" },
          );
        })
        .finally(() => {
          loading = false;
        });
    };
    load();
    window.addEventListener("focus", load);
    const interval = pollForEdits ? window.setInterval(load, REFRESH_INTERVAL_MS) : null;
    return () => {
      abort.abort();
      window.removeEventListener("focus", load);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [environmentId, cwd, workspaceMutationId, visible, pollForEdits]);

  const entryFile =
    project === null
      ? null
      : relativePath !== null && relativePath in project.fsMap
        ? relativePath
        : pickEntryFile(project.fsMap);

  const built = useBuiltCircuit({
    environmentId,
    cwd,
    visible,
    workspaceMutationId,
    build:
      entryFile === null || !project?.hashedFiles
        ? null
        : expectedBuild(entryFile, project.hashedFiles),
  });
  // Nothing new goes to the viewer until it is known whether there is a build to show instead.
  // A report needs the routing problems, which only a run of the sources has.
  const viewerFiles =
    project === null || entryFile === null || built.status === "checking"
      ? null
      : built.status === "current" && !reporting
        ? built.files
        : { fsMap: project.fsMap, mainComponentPath: entryFile };

  const view = viewStateForFile(panelState, entryFile);
  const notice = !cwd ? (
    <Notice title="No project folder" description="Open a project to see its circuit here." />
  ) : projectState.status === "failed" ? (
    <Notice
      title="Couldn't read the project"
      description="The project's files could not be read from this environment."
    />
  ) : project === null ? (
    <Notice title="Reading project files" busy />
  ) : entryFile === null ? (
    <Notice
      title="No circuit yet"
      description="This project has no .tsx files. Ask the agent for a circuit and it shows up here."
    />
  ) : viewerFiles === null && panelState.file !== entryFile && view.screen !== "source" ? (
    // The viewer still shows the file opened before this one.
    <Notice title="Reading project files" busy />
  ) : null;

  // Null until the viewer has started a run of this file's sources.
  const phases = filePhases !== null && filePhases.file === entryFile ? filePhases.phases : null;
  const source = entryFile === null ? null : (project?.fsMap[entryFile] ?? null);
  const unmuted = unmutedViews(view);
  const help =
    helpFor === null || entryFile === null ? null : helpForView(helpFor, view, entryFile);

  const pickScreen = (screen: CircuitScreen) => {
    if (entryFile === null) return;
    if (screen !== "source" && screen !== "errors" && !unmuted.has(screen)) {
      if (hasStandingTab(screen)) setHelpFor(screen);
      return;
    }
    if (canBePreferred(screen)) {
      setLocalStorageItem(PREFERRED_VIEW_STORAGE_KEY, screen, Schema.String);
    }
    dispatch({ type: "user_picked", file: entryFile, screen });
  };
  const addToPrompt = (prompt: string) => {
    const store = useComposerDraftStore.getState();
    const existing = store.getComposerDraft(props.composerDraftTarget)?.prompt ?? "";
    store.setPrompt(props.composerDraftTarget, appendToPrompt(existing, prompt));
    setHelpFor(null);
    toastManager.add({ type: "success", title: "Added to your prompt" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background" data-circuit-panel>
      {entryFile === null ? null : (
        <CircuitViewTabs
          tabs={viewTabs(view)}
          screen={view.screen}
          unmuted={unmuted}
          errorCount={countErrors(view.counts) + (view.executionError === null ? 0 : 1)}
          running={view.running}
          onPick={pickScreen}
          onOrder={() => openOrderPane(props.threadRef)}
        />
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <CircuitViewer
          key={viewerAttempt}
          file={entryFile}
          files={viewerFiles}
          screen={view.screen}
          covered={notice !== null || view.screen === "source"}
          rebuilds={rebuilds}
          dispatch={dispatch}
          onClose={props.onClose}
          onPhases={setFilePhases}
          onStartFailed={setViewerFailed}
          onRetry={() => {
            setViewerFailed(false);
            setViewerAttempt((attempt) => attempt + 1);
          }}
          frameRef={frameRef}
        />
        {notice !== null ? (
          <Cover>{notice}</Cover>
        ) : view.screen === "source" && entryFile !== null && source !== null ? (
          <div className="absolute inset-0 flex min-h-0 flex-col bg-background">
            <ReadOnlySourcePreview name={entryFile} text={source} />
          </div>
        ) : null}
      </div>
      {notice === null && project?.truncated ? (
        <p className="border-t px-3 py-1.5 text-muted-foreground text-xs">
          This project is too large to preview whole, so some files were left out.
        </p>
      ) : null}
      <CircuitViewHelpDialog
        help={help}
        onClose={() => setHelpFor(null)}
        onAddToPrompt={addToPrompt}
      />
      <AutorouterReportDialog
        open={reporting}
        cwd={cwd}
        file={entryFile}
        build={
          !cwd
            ? { state: "unavailable", reason: "Open a project to report its circuit's routing." }
            : projectState.status === "failed"
              ? {
                  state: "unavailable",
                  reason: "The project's files could not be read, so its circuit was not built.",
                }
              : project !== null && entryFile === null
                ? { state: "unavailable", reason: "This project has no circuit to build yet." }
                : viewerFailed
                  ? {
                      state: "unavailable",
                      reason:
                        "The circuit viewer didn't start, so the circuit was not built. Close this and choose Try again.",
                    }
                  : {
                      state:
                        view.running || (phases === null && view.executionError === null)
                          ? "building"
                          : "built",
                    }
        }
        phases={phases ?? []}
        onRebuild={() => setRebuilds((count) => count + 1)}
        loadPhaseInput={(phaseId) => loadPhaseInput(frameRef.current, phaseId)}
        onClose={() => useAutorouterReportRequest.setState({ requested: false })}
      />
    </div>
  );
}

/** A view is muted for want of an element, or because the file threw before rendering anything. */
function helpForView(
  viewId: StandingViewId,
  view: CircuitPanelState["view"],
  relativePath: string,
): CircuitViewHelp {
  if (view.executionError !== null) {
    return {
      title: "This file didn't run",
      description: "No view can be drawn until this error is fixed.",
      code: view.executionError,
      prompt: fixErrorPrompt(relativePath, view.executionError),
    };
  }
  const { title, description, example, prompt } = VIEW_HELP[viewId];
  return { title, description, code: example, prompt };
}

/** The views as tabs. A muted one has nothing to show, and says how to change that when pressed. */
function CircuitViewTabs(props: {
  readonly tabs: ReturnType<typeof viewTabs>;
  readonly screen: CircuitScreen;
  readonly unmuted: ReadonlySet<RenderedViewId>;
  readonly errorCount: number;
  readonly running: boolean;
  readonly onPick: (screen: CircuitScreen) => void;
  readonly onOrder: () => void;
}) {
  return (
    <div className={cn(FILE_SURFACE_SUBHEADER_CLASS, "justify-between")}>
      {/* A narrow panel scrolls the tabs sideways, so none is cut off for good. */}
      <div className="min-w-0 overflow-x-auto [scrollbar-width:none]">
        <ToggleGroup
          aria-label="Circuit view"
          variant="segmented"
          value={[props.screen]}
          onValueChange={(value) => {
            const next = value[0] as CircuitScreen | undefined;
            if (next !== undefined) props.onPick(next);
          }}
        >
          {props.tabs.map((view) => {
            const muted = view.id !== "source" && !props.unmuted.has(view.id);
            return muted ? (
              <Tooltip key={view.id}>
                <TooltipTrigger
                  render={
                    <Toggle value={view.id} aria-disabled>
                      {view.label}
                    </Toggle>
                  }
                />
                <TooltipPopup side="bottom">
                  Nothing to show yet. Click to see how to add it.
                </TooltipPopup>
              </Tooltip>
            ) : (
              <Toggle key={view.id} value={view.id}>
                {view.label}
              </Toggle>
            );
          })}
          {props.errorCount > 0 ? (
            <Toggle value="errors">
              {props.errorCount === 1 ? "1 error" : `${props.errorCount} errors`}
            </Toggle>
          ) : null}
        </ToggleGroup>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {props.running ? <Spinner className="size-3.5" /> : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button size="icon-xs" variant="outline" aria-label="Order" onClick={props.onOrder}>
                <ShoppingCart />
              </Button>
            }
          />
          <TooltipPopup side="bottom">Order this board</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * The RunFrame iframe. It starts loading at once, in parallel with the file
 * read, and receives the files when both are ready. Remount it to retry.
 */
function CircuitViewer(props: {
  /** The file on screen, which the viewer's events are about. */
  readonly file: string | null;
  /** What the viewer draws for it. Null while that is not known yet. */
  readonly files: ViewerFiles | null;
  readonly screen: CircuitScreen;
  /** True while the panel shows a notice or the source over the frame. */
  readonly covered: boolean;
  /** Raised to run the same files again. */
  readonly rebuilds: number;
  readonly dispatch: Dispatch<PanelAction>;
  readonly onClose: () => void;
  /** The phases of the run in the viewer. Null once it is sent files it has not run yet. */
  readonly onPhases: (phases: FilePhases | null) => void;
  readonly onStartFailed: (failed: boolean) => void;
  readonly onRetry: () => void;
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
}) {
  const { file, screen, covered, rebuilds, dispatch, onRetry } = props;
  const { onPhases, onStartFailed, frameRef } = props;
  const fsMap = props.files?.fsMap ?? null;
  const mainComponentPath = props.files?.mainComponentPath ?? null;
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const closePreviewTab = useEffectEvent(props.onClose);
  // What the viewer last received. Its events are about the file named here.
  const sentRef = useRef<
    ({ readonly file: string; readonly rebuilds: number } & ViewerFiles) | null
  >(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the viewer frame's messages and gives up waiting for it after a timeout
  useEffect(() => {
    let ready = false;
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (isViewerCloseRequest(event.data)) {
        // The web sandbox has an opaque origin; Electron serves the viewer on its own host.
        const viewerOrigin = isElectron ? VIEWER_FRAME.targetOrigin : "null";
        if (event.origin === viewerOrigin && document.activeElement === frame) closePreviewTab();
        return;
      }
      const message = parseViewerMessage(event.data);
      if (message === null) return;
      if (message.kind === "ready") {
        ready = true;
        setState("ready");
        return;
      }
      // The answer to a question the report dialog asked, which listens for it itself.
      if (message.kind === "autorouter_phase_input") return;
      const sentFile = sentRef.current?.file;
      if (sentFile === undefined) return;
      if (message.kind === "autorouter_phases") {
        onPhases({ file: sentFile, phases: message.phases });
        return;
      }
      const { kind, ...detail } = message;
      dispatch({ type: kind, file: sentFile, ...detail } as PanelAction);
    };
    window.addEventListener("message", onMessage);
    const timeout = window.setTimeout(() => {
      if (ready) return;
      setState("failed");
      onStartFailed(true);
    }, VIEWER_LOAD_TIMEOUT_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
    };
  }, [dispatch, onPhases, onStartFailed, frameRef]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends the files and the tab to show to the viewer frame, an external system
  useEffect(() => {
    if (state !== "ready" || file === null || fsMap === null || mainComponentPath === null) return;
    const sent = sentRef.current;
    const filesChanged =
      sent?.file !== file ||
      sent.fsMap !== fsMap ||
      sent.mainComponentPath !== mainComponentPath ||
      sent.rebuilds !== rebuilds;
    frameRef.current?.contentWindow?.postMessage(
      {
        runframe_type: "runframe_props_changed",
        // The files go once: resending them would run the circuit again for a change of tab.
        runframe_props: filesChanged
          ? viewerFileProps({ fsMap, mainComponentPath, screen, rebuilds })
          : viewerTabProps(screen),
      },
      VIEWER_FRAME.targetOrigin,
    );
    if (!filesChanged) return;
    sentRef.current = { file, fsMap, mainComponentPath, rebuilds };
    // The phases the viewer reported were of what it had before.
    onPhases(null);
    dispatch({ type: "files_sent", file });
  }, [state, file, fsMap, mainComponentPath, screen, rebuilds, dispatch, onPhases, frameRef]);

  return (
    <>
      <iframe
        ref={frameRef}
        src={VIEWER_FRAME.src}
        title="Circuit preview"
        // Never the app's origin, in either sandbox: see viewerFrame.
        sandbox={VIEWER_FRAME.sandbox}
        className={cn(
          "min-h-0 w-full flex-1 border-0 bg-white",
          (covered || state !== "ready") && "invisible",
        )}
      />
      {covered || state === "ready" ? null : (
        <Cover>
          {state === "loading" ? (
            <Notice title="Loading the circuit viewer" busy />
          ) : (
            <Notice
              title="The circuit viewer didn't start"
              description="The viewer is part of the app, so this is a fault in the app and not in your project."
              action={
                <Button size="sm" variant="outline" onClick={onRetry}>
                  Try again
                </Button>
              }
            />
          )}
        </Cover>
      )}
    </>
  );
}

export function Cover(props: { readonly children: React.ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center">{props.children}</div>;
}

export function Notice(props: {
  readonly title: string;
  readonly description?: string;
  readonly busy?: boolean;
  readonly action?: React.ReactNode;
}) {
  return (
    <Empty size="compact" role="status">
      <EmptyHeader>
        <EmptyTitle>
          <span className="inline-flex items-center gap-2">
            {props.busy ? <Spinner className="size-4" /> : null}
            {props.title}
          </span>
        </EmptyTitle>
        {props.description ? <EmptyDescription>{props.description}</EmptyDescription> : null}
      </EmptyHeader>
      {props.action}
    </Empty>
  );
}
