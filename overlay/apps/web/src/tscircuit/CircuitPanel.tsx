import type { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { type Dispatch, useEffect, useReducer, useRef, useState } from "react";

import { ReadOnlySourcePreview } from "~/components/files/AttachmentFilePreview";
import { FILE_SURFACE_SUBHEADER_CLASS } from "~/components/files/fileSurfaceChrome";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";

import { type CircuitViewHelp, CircuitViewHelpDialog } from "./CircuitViewHelpDialog";
import {
  appendToPrompt,
  CIRCUIT_VIEWS,
  type CircuitPanelState,
  circuitPanelReducer,
  type CircuitScreen,
  type CircuitViewAction,
  countErrors,
  DEFAULT_CIRCUIT_VIEW,
  fixErrorPrompt,
  guessViewsFromSource,
  initialCircuitPanelState,
  type RenderedViewId,
  unmutedViews,
  VIEW_HELP,
  viewStateForFile,
} from "./circuitViews";
import { type LoadedProject, loadProjectFsMap, pickEntryFile } from "./projectFsMap";
import { parseViewerMessage, viewerFileProps, viewerTabProps } from "./runframeMessages";

/**
 * RunFrame's hosted embed: a bare viewer that takes files over postMessage. A
 * build can name another deployment, such as the preview of a RunFrame change.
 */
const RUNFRAME_URL: string =
  import.meta.env.VITE_TSCIRCUIT_RUNFRAME_URL || "https://runframe.tscircuit.com/iframe.html";
const RUNFRAME_ORIGIN = new URL(RUNFRAME_URL).origin;
const VIEWER_LOAD_TIMEOUT_MS = 30_000;
const REFRESH_INTERVAL_MS = 3_000;
/** Larger projects refresh on focus and after agent work, not on a timer. */
const MAX_FILES_TO_POLL = 40;
const PREFERRED_VIEW_STORAGE_KEY = "tscircuit-desktop:circuit-view";
const PreferredView = Schema.Literals(["source", "pcb", "schematic", "cad", "system", "assembly"]);

type PanelAction = CircuitViewAction & { readonly file: string };

type ProjectState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly project: LoadedProject;
      /** The workspace mutation this read was made for. */
      readonly revision: string | null;
    }
  | { readonly status: "failed" };

function sameProject(a: LoadedProject, b: LoadedProject): boolean {
  const paths = Object.keys(a.fsMap);
  return (
    a.truncated === b.truncated &&
    paths.length === Object.keys(b.fsMap).length &&
    paths.every((path) => a.fsMap[path] === b.fsMap[path])
  );
}

export default function CircuitPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  /** The file the user opened, or null to render the project's entry file. */
  readonly relativePath: string | null;
  readonly visible: boolean;
  readonly workspaceMutationId: string | null;
  /** The composer that "Add to prompt" writes to. */
  readonly composerDraftTarget: ComposerThreadTarget;
}) {
  const { environmentId, cwd, relativePath, visible, workspaceMutationId } = props;
  const [viewerAttempt, setViewerAttempt] = useState(0);
  const [panelState, dispatch] = useReducer(
    circuitPanelReducer,
    getLocalStorageItem(PREFERRED_VIEW_STORAGE_KEY, PreferredView) ?? DEFAULT_CIRCUIT_VIEW,
    initialCircuitPanelState,
  );
  // False for a viewer deployment that draws its own header and reports only errors.
  const [hostControlled, setHostControlled] = useState(true);
  const [helpFor, setHelpFor] = useState<RenderedViewId | null>(null);
  const [projectState, setProjectState] = useState<ProjectState>({ status: "loading" });

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
            // Unchanged files keep their identity, so the viewer is not asked to render again.
            if (current.status !== "ready" || !sameProject(current.project, loaded)) {
              return { status: "ready", project: loaded, revision: workspaceMutationId };
            }
            return current.revision === workspaceMutationId
              ? current
              : { ...current, revision: workspaceMutationId };
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
  ) : null;

  const view = viewStateForFile(panelState, entryFile);
  const source = entryFile === null ? null : (project?.fsMap[entryFile] ?? null);
  const unmuted = unmutedViews(view, hostControlled ? null : guessViewsFromSource(source));
  const help =
    helpFor === null || entryFile === null ? null : helpForView(helpFor, view, entryFile);

  const pickScreen = (screen: CircuitScreen) => {
    if (entryFile === null) return;
    if (screen !== "source" && screen !== "errors" && !unmuted.has(screen)) {
      setHelpFor(screen);
      return;
    }
    if (screen !== "errors") setLocalStorageItem(PREFERRED_VIEW_STORAGE_KEY, screen, PreferredView);
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
          screen={view.screen}
          unmuted={unmuted}
          errorCount={countErrors(view.counts) + (view.executionError === null ? 0 : 1)}
          running={view.running}
          onPick={pickScreen}
        />
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <CircuitViewer
          key={viewerAttempt}
          fsMap={project?.fsMap ?? null}
          mainComponentPath={entryFile}
          screen={view.screen}
          covered={notice !== null || view.screen === "source"}
          hostControlled={hostControlled}
          onHostControlledChange={setHostControlled}
          dispatch={dispatch}
          onRetry={() => setViewerAttempt((attempt) => attempt + 1)}
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
    </div>
  );
}

/** A view is muted for want of an element, or because the file threw before rendering anything. */
function helpForView(
  viewId: RenderedViewId,
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
  readonly screen: CircuitScreen;
  readonly unmuted: ReadonlySet<RenderedViewId>;
  readonly errorCount: number;
  readonly running: boolean;
  readonly onPick: (screen: CircuitScreen) => void;
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
          {CIRCUIT_VIEWS.map((view) => {
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
      {props.running ? <Spinner className="size-3.5" /> : null}
    </div>
  );
}

/**
 * The RunFrame iframe. It starts loading at once, in parallel with the file
 * read, and receives the files when both are ready. Remount it to retry.
 */
function CircuitViewer(props: {
  readonly fsMap: Record<string, string> | null;
  readonly mainComponentPath: string | null;
  readonly screen: CircuitScreen;
  /** True while the panel shows a notice or the source over the frame. */
  readonly covered: boolean;
  readonly hostControlled: boolean;
  readonly onHostControlledChange: (hostControlled: boolean) => void;
  readonly dispatch: Dispatch<PanelAction>;
  readonly onRetry: () => void;
}) {
  const { fsMap, mainComponentPath, screen, covered, hostControlled, dispatch, onRetry } = props;
  const { onHostControlledChange } = props;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "unreachable">("loading");
  // The files the viewer last received. Its events are about the file named here.
  const sentRef = useRef<{ fsMap: Record<string, string>; mainComponentPath: string } | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the viewer frame's messages and gives up waiting for it after a timeout
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== RUNFRAME_ORIGIN) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = parseViewerMessage(event.data);
      if (message === null) return;
      if (message.kind === "ready") {
        onHostControlledChange(message.hostControlled);
        setState("ready");
        return;
      }
      const file = sentRef.current?.mainComponentPath;
      if (file === undefined) return;
      const { kind, ...detail } = message;
      dispatch({ type: kind, file, ...detail } as PanelAction);
    };
    window.addEventListener("message", onMessage);
    const timeout = window.setTimeout(
      () => setState((current) => (current === "loading" ? "unreachable" : current)),
      VIEWER_LOAD_TIMEOUT_MS,
    );
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
    };
  }, [dispatch, onHostControlledChange]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends the files and the tab to show to the viewer frame, an external system
  useEffect(() => {
    if (state !== "ready" || fsMap === null || mainComponentPath === null) return;
    const sent = sentRef.current;
    const filesChanged = sent?.fsMap !== fsMap || sent.mainComponentPath !== mainComponentPath;
    frameRef.current?.contentWindow?.postMessage(
      {
        runframe_type: "runframe_props_changed",
        // The files go once: resending them would run the circuit again for a change of tab.
        runframe_props: filesChanged
          ? viewerFileProps({ fsMap, mainComponentPath, screen, hostControlled })
          : viewerTabProps(screen, hostControlled),
      },
      RUNFRAME_ORIGIN,
    );
    if (!filesChanged) return;
    sentRef.current = { fsMap, mainComponentPath };
    dispatch({ type: "files_sent", file: mainComponentPath, reportsRuns: hostControlled });
  }, [state, fsMap, mainComponentPath, screen, hostControlled, dispatch]);

  return (
    <>
      <iframe
        ref={frameRef}
        src={RUNFRAME_URL}
        title="Circuit preview"
        // oxlint-disable-next-line react/iframe-missing-sandbox -- the viewer is cross-origin and needs its own origin for workers and storage
        sandbox="allow-scripts allow-same-origin allow-downloads"
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
              title="Couldn't load the circuit viewer"
              description={`The viewer is loaded from ${new URL(RUNFRAME_URL).host} and needs an internet connection.`}
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

function Cover(props: { readonly children: React.ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center">{props.children}</div>;
}

function Notice(props: {
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
