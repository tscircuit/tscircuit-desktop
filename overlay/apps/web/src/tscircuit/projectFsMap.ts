import type { EnvironmentId } from "@t3tools/contracts";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";

/** Files RunFrame can evaluate or import, keyed by workspace-relative path. */
export type ProjectFsMap = Record<string, string>;

export interface LoadedProject {
  readonly fsMap: ProjectFsMap;
  /** True when the project was too large to send whole. */
  readonly truncated: boolean;
}

const SOURCE_FILE = /\.(tsx|ts|jsx|js|mjs|cjs|json)$/i;
const LOCK_FILE = /(^|\/)(package-lock\.json|bun\.lock|pnpm-lock\.yaml|yarn\.lock)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", "out", "coverage"]);
const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 2_000_000;
const MAX_DEPTH = 6;
const READ_BATCH_SIZE = 8;

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Dependencies and build output are resolved by RunFrame itself, not sent from disk. */
export const shouldWalkDirectory = (path: string): boolean => {
  const name = baseName(path);
  return !name.startsWith(".") && !SKIPPED_DIRECTORIES.has(name);
};

export const isProjectSourceFile = (path: string): boolean =>
  SOURCE_FILE.test(path) && !LOCK_FILE.test(path) && !baseName(path).startsWith(".");

const ENTRY_FILE_NAMES = ["index.tsx", "index.circuit.tsx", "main.tsx", "main.circuit.tsx"];

/** The file to render when the user has not picked one. */
export function pickEntryFile(fsMap: ProjectFsMap): string | null {
  const configured = readConfiguredEntrypoint(fsMap["tscircuit.config.json"]);
  if (configured !== null && configured in fsMap) return configured;
  for (const name of ENTRY_FILE_NAMES) {
    if (name in fsMap) return name;
  }
  const depth = (path: string) => path.split("/").length;
  const circuits = Object.keys(fsMap)
    .filter((path) => /\.tsx$/i.test(path))
    .toSorted((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  return circuits.find((path) => /\.circuit\.tsx$/i.test(path)) ?? circuits[0] ?? null;
}

function readConfiguredEntrypoint(config: string | undefined): string | null {
  if (config === undefined) return null;
  try {
    const entrypoint = (JSON.parse(config) as { mainEntrypoint?: unknown }).mainEntrypoint;
    return typeof entrypoint === "string" ? entrypoint.replace(/^\.\//, "") : null;
  } catch {
    return null;
  }
}

const QUERY_OPTIONS = { refresh: true, reportDefect: false, reportFailure: false } as const;

/**
 * Reads the project's source files through the environment, so it works for
 * remote environments too. Always refetches: the point is to see new edits.
 */
export async function loadProjectFsMap(
  environmentId: EnvironmentId,
  cwd: string,
  signal: AbortSignal,
): Promise<LoadedProject> {
  const filePaths: string[] = [];
  let truncated = false;
  let directories = [""];

  for (let depth = 0; depth <= MAX_DEPTH && directories.length > 0; depth += 1) {
    const listings = await Promise.all(
      directories.map((directoryPath) =>
        executeAtomQuery(
          appAtomRegistry,
          // Always pass a path: without one the server lists the whole indexed tree.
          projectEnvironment.listEntries({ environmentId, input: { cwd, directoryPath } }),
          { ...QUERY_OPTIONS, signal },
        ),
      ),
    );
    const nextDirectories: string[] = [];
    for (const listing of listings) {
      if (listing._tag !== "Success") continue;
      truncated ||= listing.value.truncated;
      for (const entry of listing.value.entries) {
        if (entry.ignored) continue;
        if (entry.kind === "directory") {
          if (shouldWalkDirectory(entry.path)) nextDirectories.push(entry.path);
        } else if (isProjectSourceFile(entry.path)) {
          filePaths.push(entry.path);
        }
      }
    }
    directories = nextDirectories;
  }
  if (directories.length > 0) truncated = true;

  const fsMap: ProjectFsMap = {};
  let totalBytes = 0;
  const wanted = filePaths.toSorted().slice(0, MAX_FILES);
  if (wanted.length < filePaths.length) truncated = true;

  for (let start = 0; start < wanted.length; start += READ_BATCH_SIZE) {
    const batch = wanted.slice(start, start + READ_BATCH_SIZE);
    const results = await Promise.all(
      batch.map((relativePath) =>
        executeAtomQuery(
          appAtomRegistry,
          projectEnvironment.readFile({ environmentId, input: { cwd, relativePath } }),
          { ...QUERY_OPTIONS, signal },
        ),
      ),
    );
    for (const [index, result] of results.entries()) {
      const path = batch[index];
      if (path === undefined || result._tag !== "Success") continue;
      const file = result.value;
      if (file.exists === false) continue;
      if (file.truncated || totalBytes + file.byteLength > MAX_TOTAL_BYTES) {
        truncated = true;
        continue;
      }
      totalBytes += file.byteLength;
      fsMap[path] = file.contents;
    }
  }

  return { fsMap, truncated };
}
