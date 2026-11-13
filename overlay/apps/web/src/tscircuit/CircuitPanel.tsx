import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";

import { type LoadedProject, loadProjectFsMap, pickEntryFile } from "./projectFsMap";

/** RunFrame's hosted embed: a bare viewer that takes files over postMessage. */
const RUNFRAME_URL = "https://runframe.tscircuit.com/iframe.html";
const RUNFRAME_ORIGIN = new URL(RUNFRAME_URL).origin;
const VIEWER_LOAD_TIMEOUT_MS = 30_000;
const REFRESH_INTERVAL_MS = 3_000;
/** Larger projects refresh on focus and after agent work, not on a timer. */
const MAX_FILES_TO_POLL = 40;

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
}) {
  const { environmentId, cwd, relativePath, visible, workspaceMutationId } = props;
  const [viewerAttempt, setViewerAttempt] = useState(0);
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background" data-circuit-panel>
      <CircuitViewer
        key={viewerAttempt}
        fsMap={project?.fsMap ?? null}
        mainComponentPath={entryFile}
        covered={notice !== null}
        onRetry={() => setViewerAttempt((attempt) => attempt + 1)}
      />
      {notice !== null ? <Cover>{notice}</Cover> : null}
      {notice === null && project?.truncated ? (
        <p className="border-t px-3 py-1.5 text-muted-foreground text-xs">
          This project is too large to preview whole, so some files were left out.
        </p>
      ) : null}
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
  /** True while the panel shows its own notice over the frame. */
  readonly covered: boolean;
  readonly onRetry: () => void;
}) {
  const { fsMap, mainComponentPath, covered, onRetry } = props;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "unreachable">("loading");

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the viewer frame's ready message and gives up after a timeout
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== RUNFRAME_ORIGIN) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      const type = (event.data as { runframe_type?: unknown } | null)?.runframe_type;
      if (type === "runframe_ready_to_receive") setState("ready");
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
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends the files and the active file to the viewer frame, an external system
  useEffect(() => {
    if (state !== "ready" || fsMap === null || mainComponentPath === null) return;
    frameRef.current?.contentWindow?.postMessage(
      {
        runframe_type: "runframe_props_changed",
        runframe_props: {
          fsMap,
          mainComponentPath,
          defaultActiveTab: "pcb",
          showRunButton: false,
          showFileMenu: false,
          showToggleFullScreen: false,
        },
      },
      RUNFRAME_ORIGIN,
    );
  }, [state, fsMap, mainComponentPath]);

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
              description="The viewer is loaded from runframe.tscircuit.com and needs an internet connection."
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
