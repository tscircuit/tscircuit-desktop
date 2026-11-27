import type { EnvironmentId } from "@t3tools/contracts";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { filesystemEnvironment } from "~/state/filesystem";
import { projectEnvironment } from "~/state/projects";
import type { circuitBuildOutput } from "./builtCircuit";
import type { SavedCircuitBuild } from "./savedCircuitBuild";

const HISTORY_DIRECTORY = ".tscircuit-build-history";
type BuildOutput = NonNullable<ReturnType<typeof circuitBuildOutput>>;

interface BuildHistoryReader {
  readonly list: (
    directory: string,
  ) => Promise<ReadonlyArray<{ readonly path: string; readonly kind: string }>>;
  readonly existingFiles: (paths: ReadonlyArray<string>) => Promise<ReadonlyArray<boolean>>;
}

/** Reads CLI archive metadata only. Artifact bytes are fetched only when a build is selected. */
export async function readCircuitBuildHistory(
  reader: BuildHistoryReader,
  output: BuildOutput,
): Promise<ReadonlyArray<SavedCircuitBuild>> {
  const prefix = output.projectDir === "" ? "" : `${output.projectDir}/`;
  const directory = `${prefix}${HISTORY_DIRECTORY}`;
  const root = await reader.list(output.projectDir);
  const entries = root.some((entry) => entry.path === directory && entry.kind === "directory")
    ? await reader.list(directory)
    : [];
  const candidates: Array<{ path: string; at: number | null }> = [];
  for (const entry of entries) {
    const name = entry.path.slice(directory.length + 1);
    if (
      entry.kind !== "directory" ||
      entry.path !== `${directory}/${name}` ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/.test(name)
    )
      continue;
    const date = new Date(name.replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3"));
    if (!Number.isFinite(date.getTime()) || date.toISOString().replaceAll(":", "-") !== name)
      continue;
    candidates.push({
      path: `${entry.path}/${output.path.slice(prefix.length)}`,
      at: date.getTime(),
    });
  }
  candidates.sort((a, b) => a.at! - b.at!);
  // Even an out-of-date output is useful history. It must never pass the live source freshness gate.
  candidates.push({ path: output.path, at: null });
  const steps: SavedCircuitBuild[] = [];
  for (let offset = 0; offset < candidates.length; offset += 64) {
    const batch = candidates.slice(offset, offset + 64);
    const exists = await reader.existingFiles(batch.map((entry) => entry.path));
    for (const [index, entry] of batch.entries()) {
      if (!exists[index]) continue;
      steps.push({
        id: `archive:${entry.path}`,
        at: entry.at,
        label: entry.at === null ? "Latest disk build · build time unavailable" : "Saved build",
        path: entry.path,
      });
    }
  }
  return steps;
}

export function loadCircuitBuildHistory(
  environmentId: EnvironmentId,
  cwd: string,
  output: BuildOutput,
  signal: AbortSignal,
) {
  const options = { signal, refresh: true, reportDefect: false, reportFailure: false } as const;
  return readCircuitBuildHistory(
    {
      list: async (directoryPath) => {
        const result = await executeAtomQuery(
          appAtomRegistry,
          projectEnvironment.listEntries({ environmentId, input: { cwd, directoryPath } }),
          options,
        );
        if (result._tag !== "Success" || result.value.truncated)
          throw new Error("Could not list saved builds");
        return result.value.entries;
      },
      existingFiles: async (paths) => {
        const result = await executeAtomQuery(
          appAtomRegistry,
          filesystemEnvironment.getMetadata({
            environmentId,
            input: { paths: paths.map((path) => `${cwd.replace(/[\\/]+$/, "")}/${path}`) },
          }),
          options,
        );
        if (result._tag !== "Success") throw new Error("Could not inspect saved builds");
        return result.value.entries.map((entry) => entry?.kind === "file");
      },
    },
    output,
  );
}
