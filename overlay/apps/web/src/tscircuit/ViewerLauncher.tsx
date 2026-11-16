import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { CircuitBoard } from "lucide-react";
import { useEffect } from "react";

import { Button } from "~/components/ui/button";
import { useRightPanelStore } from "~/rightPanelStore";

import { useBuiltCircuit } from "./CircuitPanel";
import { expectedBuild } from "./builtCircuit";
import { circuitBuildKey } from "./circuitBuildHistory";
import { EMPTY_CIRCUIT_BUILDS, rememberCircuitBuild, useCircuitBuildStore } from "./circuitBuildStore";
import { pickEntryFile } from "./projectFsMap";
import { useProjectFiles } from "./useProjectFiles";

/** Finds builds even with the right panel closed, so no source-file click is required. */
export function ViewerLauncher(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceMutationId: string | null;
}) {
  const files = useProjectFiles({ ...props, visible: true });
  const project = files.status === "ready" ? files.project : null;
  const entry = project === null ? null : pickEntryFile(project.fsMap);
  const key = circuitBuildKey(props.environmentId, props.cwd ?? "", entry ?? "");
  const built = useBuiltCircuit({
    ...props,
    visible: true,
    build: entry === null || !project?.hashedFiles ? null : expectedBuild(entry, project.hashedFiles),
  });
  const builtFiles = built.status === "current" ? built.files : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- imports a completed build read from the workspace into the session's viewer history
  useEffect(() => {
    if (builtFiles === null) return;
    const text = builtFiles.fsMap[builtFiles.mainComponentPath];
    if (text !== undefined) rememberCircuitBuild(key, text);
  }, [key, builtFiles]);
  const ready = useCircuitBuildStore(
    (state) => (state.byCircuit[key] ?? EMPTY_CIRCUIT_BUILDS).length > 0,
  );
  return (
    <aside aria-label="Circuit viewers" className="flex shrink-0 flex-col border-l bg-background px-1 py-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={!ready}
        title={ready ? "Open the board viewers" : "Viewers will be available after a successful circuit build"}
        onClick={() => useRightPanelStore.getState().open(props.threadRef, "circuit")}
        className="h-auto flex-col gap-1 px-2 py-2"
      >
        <CircuitBoard className="size-4" aria-hidden />
        <span className="text-xs">Viewers</span>
      </Button>
    </aside>
  );
}
