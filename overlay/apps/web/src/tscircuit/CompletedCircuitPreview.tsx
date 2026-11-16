import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";

import type { CircuitBuildVersion } from "./circuitBuildHistory";
import type { CircuitScreen } from "./circuitViews";
import { parseViewerMessage, viewerFileProps, viewerTabProps } from "./runframeMessages";
import { viewerFrame } from "./viewerFrame";
import { isElectron } from "~/env";

const FRAME = viewerFrame({
  desktop: isElectron,
  protocol: window.location.protocol,
  baseUrl: import.meta.env.BASE_URL,
});

/** Load the next completed output off screen, retaining the current frame until it is ready. */
export function CompletedCircuitPreview(props: {
  readonly version: CircuitBuildVersion;
  readonly screen: CircuitScreen;
  readonly onTabRequested: (tab: string) => void;
}) {
  const [shown, setShown] = useState<CircuitBuildVersion | null>(null);
  const [failed, setFailed] = useState<number | null>(null);
  const loaded = useStableCallback((version: CircuitBuildVersion) => {
    setShown(version);
    setFailed(null);
  });
  const failedLoad = useStableCallback((version: CircuitBuildVersion) => setFailed(version.id));
  const pending = shown?.id === props.version.id ? null : props.version;
  return (
    <div className="absolute inset-0 bg-white">
      {[shown, pending].map((version) =>
        version === null ? null : (
          <SnapshotFrame
            key={version.id}
            version={version}
            screen={props.screen}
            visible={shown?.id === version.id}
            onLoaded={loaded}
            onFailed={failedLoad}
            onTabRequested={props.onTabRequested}
          />
        ),
      )}
      {failed === props.version.id ? (
        <p role="status" className="absolute inset-x-0 top-0 bg-background p-3 text-sm">
          Could not load this version.
          {shown ? " The previous version is still visible." : " Reopen Viewers to try again."}
        </p>
      ) : shown === null ? (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center bg-background text-sm text-muted-foreground"
        >
          Loading completed board…
        </div>
      ) : null}
    </div>
  );
}

function SnapshotFrame(props: {
  readonly version: CircuitBuildVersion;
  readonly screen: CircuitScreen;
  readonly visible: boolean;
  readonly onLoaded: (version: CircuitBuildVersion) => void;
  readonly onFailed: (version: CircuitBuildVersion) => void;
  readonly onTabRequested: (tab: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const { version, onLoaded, onFailed, onTabRequested } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- waits for a completed Circuit JSON frame to finish loading before revealing it
  useEffect(() => {
    let finished = false;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = parseViewerMessage(event.data);
      if (message?.kind === "ready") {
        setReady(true);
        frameRef.current?.contentWindow?.postMessage(
          {
            runframe_type: "runframe_props_changed",
            runframe_props: viewerFileProps({ ...version.files, screen: "pcb", rebuilds: 0 }),
          },
          FRAME.targetOrigin,
        );
      } else if (message?.kind === "run_completed" && !message.failed) {
        finished = true;
        onLoaded(version);
      } else if (
        message?.kind === "run_failed" ||
        (message?.kind === "run_completed" && message.failed)
      ) {
        finished = true;
        onFailed(version);
      } else if (message?.kind === "tab_requested") {
        onTabRequested(message.tab);
      }
    };
    window.addEventListener("message", onMessage);
    const timeout = window.setTimeout(() => {
      if (!finished) onFailed(version);
    }, 30_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
    };
  }, [version, onLoaded, onFailed, onTabRequested]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- changes only the displayed tab in the external viewer; completed JSON is sent once
  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage(
      {
        runframe_type: "runframe_props_changed",
        runframe_props: viewerTabProps(props.screen),
      },
      FRAME.targetOrigin,
    );
  }, [ready, props.screen]);

  return (
    <iframe
      ref={frameRef}
      src={FRAME.src}
      sandbox={FRAME.sandbox}
      title={props.visible ? "Completed circuit preview" : "Loading completed circuit"}
      aria-hidden={!props.visible}
      tabIndex={props.visible ? 0 : -1}
      className={`absolute inset-0 size-full border-0 bg-white ${props.visible ? "" : "invisible"}`}
    />
  );
}
