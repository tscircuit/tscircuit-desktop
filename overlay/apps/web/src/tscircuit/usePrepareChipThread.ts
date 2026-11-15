import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import {
  CommandId,
  ORCHESTRATION_V2_WS_METHODS,
  type ModelSelection,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type ProjectId,
  type RuntimeMode,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readThreadShell } from "~/state/entities";
import { environmentThreadShells } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { waitForAtomValue } from "~/state/waitForAtomValue";
import { DEFAULT_INTERACTION_MODE } from "~/types";

const launchThread = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "tscircuit:launch-chip-parent",
  tag: ORCHESTRATION_V2_WS_METHODS.launchThread,
});

export function usePrepareChipThread() {
  const launch = useOrchestrationCommand(launchThread, { reportFailure: false });

  return async ({
    threadRef,
    projectId,
    modelSelection,
    runtimeMode,
    workspaceStrategy,
  }: {
    threadRef: ScopedThreadRef;
    projectId: ProjectId;
    modelSelection: ModelSelection;
    runtimeMode: RuntimeMode;
    workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy;
  }): Promise<string | null> => {
    if (readThreadShell(threadRef) === null) {
      const result = await launch({
        environmentId: threadRef.environmentId,
        input: {
          commandId: CommandId.make(`add-chip-parent:${threadRef.threadId}`),
          threadId: threadRef.threadId,
          projectId,
          title: "New thread",
          modelSelection,
          runtimeMode,
          interactionMode: DEFAULT_INTERACTION_MODE,
          workspaceStrategy,
        },
      });
      if (result._tag === "Failure") return "Could not prepare the project thread. Try again.";
    }

    const needsWorktree = workspaceStrategy.type === "worktree";
    const ready = await waitForAtomValue({
      registry: appAtomRegistry,
      atom: environmentThreadShells.threadShellAtom(threadRef),
      predicate: (shell) => shell !== null && (!needsWorktree || shell.worktreePath !== null),
      timeoutMs: needsWorktree ? 30_000 : 5_000,
    });
    if (ready) return null;
    return needsWorktree
      ? "The project worktree isn’t ready. Check its setup and try again."
      : "The project thread didn’t reach this client. Try again.";
  };
}
