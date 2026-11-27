import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import type { circuitBuildOutput } from "./builtCircuit";
import { loadCircuitBuildHistory } from "./circuitBuildHistory";
import { type SavedCircuitBuild, isDrawableCircuitBuild } from "./savedCircuitBuild";
import { readBuiltCircuitJson } from "./projectFsMap";

const HISTORY_REFRESH_INTERVAL_MS = 3_000;

export function useCircuitBuildHistory(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly output: ReturnType<typeof circuitBuildOutput>;
  readonly visible: boolean;
  readonly workspaceMutationId: string | null;
}) {
  const { environmentId, cwd, visible, workspaceMutationId } = input;
  const projectDir = input.output?.projectDir ?? null;
  const path = input.output?.path ?? null;
  const scope = JSON.stringify([environmentId, cwd, projectDir, path]);
  const [found, setFound] = useState<{
    scope: string;
    revision: string | null;
    steps: ReadonlyArray<SavedCircuitBuild>;
    failed: boolean;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes persisted build metadata while visible, including builds created outside the app
  useEffect(() => {
    if (!visible || !cwd || projectDir === null || path === null) return;
    const abort = new AbortController();
    let loading = false;
    const load = () => {
      if (loading) return;
      loading = true;
      loadCircuitBuildHistory(environmentId, cwd, { projectDir, path }, abort.signal)
        .then((steps) => {
          if (!abort.signal.aborted)
            setFound({ scope, revision: workspaceMutationId, steps, failed: false });
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setFound((previous) => ({
              scope,
              revision: workspaceMutationId,
              steps: previous?.scope === scope ? previous.steps : [],
              failed: true,
            }));
        })
        .finally(() => {
          loading = false;
        });
    };
    load();
    window.addEventListener("focus", load);
    const interval = window.setInterval(load, HISTORY_REFRESH_INTERVAL_MS);
    return () => {
      abort.abort();
      window.removeEventListener("focus", load);
      window.clearInterval(interval);
    };
  }, [environmentId, cwd, projectDir, path, scope, visible, workspaceMutationId]);
  return {
    steps: found?.scope === scope ? found.steps : [],
    failed: found?.scope === scope && found.revision === workspaceMutationId && found.failed,
  };
}

export function useSavedCircuitBuild(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | undefined;
  readonly path: string | null;
  readonly scope: string | null;
  readonly selection: object | null;
}) {
  const { environmentId, cwd, path, scope, selection } = input;
  const key = JSON.stringify([environmentId, cwd, path, scope]);
  const [found, setFound] = useState<{
    key: string;
    selection: object | null;
    text: string | null;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fetches one immutable historical artifact; scope/selection changes abort and discard late reads
  useEffect(() => {
    if (!cwd || path === null) return;
    const abort = new AbortController();
    readBuiltCircuitJson(environmentId, cwd, path, abort.signal)
      .then((text) => {
        if (!abort.signal.aborted)
          setFound({
            key,
            selection,
            text: text !== null && isDrawableCircuitBuild(text) ? text : null,
          });
      })
      .catch(() => {
        if (!abort.signal.aborted) setFound({ key, selection, text: null });
      });
    return () => abort.abort();
  }, [environmentId, cwd, path, key, selection]);
  const current = found?.key === key && found.selection === selection;
  return { loading: path !== null && !current, text: current ? found.text : null };
}
