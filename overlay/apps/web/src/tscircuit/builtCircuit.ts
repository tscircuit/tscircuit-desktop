/**
 * tscircuit desktop: a file `tsci build` already built is drawn from the build's Circuit JSON
 * instead of being run again. A build carries a hash of the sources it was made from, and the
 * rules here repeat the CLI's (tscircuit/cli, lib/shared/circuit-json-build-cache.ts) to work
 * out the same hash. Where they differ the hashes differ, and the file is run as before.
 */
import { md5 } from "@noble/hashes/legacy";
import { bytesToHex } from "@noble/hashes/utils";

/** Files by workspace-relative path. */
type Files = Readonly<Record<string, string>>;

const HASHED_EXTENSIONS = new Set([
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".json",
  ".txt",
  ".md",
  ".obj",
  ".kicad_mod",
  ".kicad_pcb",
  ".kicad_pro",
  ".kicad_sch",
  ".kicad_sym",
]);
const UNHASHED_DIRECTORIES = new Set(["node_modules", "dist", "build", ".git"]);

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The extension as Node's `path.extname` gives it: none for a dotfile such as `.npmrc`. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/** Whether `tsci build` reads the files in this folder into its hash. */
export const isHashedDirectory = (path: string): boolean => {
  const name = baseName(path);
  return !name.startsWith(".") && !UNHASHED_DIRECTORIES.has(name);
};

/** Whether `tsci build` reads this file into its hash. Its folders must pass `isHashedDirectory`. */
export const isHashedSourceFile = (path: string): boolean => {
  const name = baseName(path);
  return !name.endsWith(".circuit.json") && HASHED_EXTENSIONS.has(extensionOf(name));
};

/**
 * The folder `tsci build` treats as the project of a file: the nearest one
 * above it with a package.json, or the workspace itself ("").
 */
function projectDirOf(sourcePath: string, files: Files): string {
  let directory = sourcePath;
  while (directory.includes("/")) {
    directory = directory.slice(0, directory.lastIndexOf("/"));
    if (`${directory}/package.json` in files) return directory;
  }
  return "";
}

/** Where `tsci build` writes the Circuit JSON of a file, or null for a file it does not build. */
function builtCircuitJsonPath(sourcePath: string, projectDir: string): string | null {
  if (!/\.tsx$/.test(sourcePath)) return null;
  const prefix = projectDir === "" ? "" : `${projectDir}/`;
  if (!sourcePath.startsWith(prefix)) return null;
  const outputName = sourcePath.slice(prefix.length).replace(/(\.board|\.circuit)?\.tsx$/, "");
  return `${prefix}dist/${outputName}/circuit.json`;
}

/** The order `tsci build` reads files in: each folder's entries by name, folders in their place. */
function compareAsWalked(a: string, b: string): number {
  const aParts = a.split("/");
  const bParts = b.split("/");
  for (let index = 0; index < Math.min(aParts.length, bParts.length); index += 1) {
    const aPart = aParts[index] ?? "";
    const bPart = bParts[index] ?? "";
    if (aPart !== bPart) return aPart.localeCompare(bPart);
  }
  return aParts.length - bParts.length;
}

/** Hashing megabytes of source is not work to repeat on every render of the same files. */
const knownHashes = new WeakMap<Files, Map<string, string>>();

function sourceFilesystemHash(files: Files, projectDir: string): string {
  const known = knownHashes.get(files) ?? new Map<string, string>();
  knownHashes.set(files, known);
  const hash = known.get(projectDir) ?? hashSources(files, projectDir);
  known.set(projectDir, hash);
  return hash;
}

/** The hash `tsci build` gives the sources in `projectDir`, read in the order the CLI walks them. */
function hashSources(files: Files, projectDir: string): string {
  const prefix = projectDir === "" ? "" : `${projectDir}/`;
  const encoder = new TextEncoder();
  const hash = md5.create();
  const relativePaths = Object.keys(files)
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length))
    .toSorted(compareAsWalked);
  for (const relativePath of relativePaths) {
    const path = encoder.encode(relativePath);
    const content = encoder.encode(files[prefix + relativePath] ?? "");
    hash.update(encoder.encode(`${path.length}:`));
    hash.update(path);
    hash.update(encoder.encode(`${content.length}:`));
    hash.update(content);
  }
  return bytesToHex(hash.digest());
}

/** The CLI output location, independent of whether its sources are current. */
export function circuitBuildOutput(sourcePath: string, files: Files) {
  const projectDir = projectDirOf(sourcePath, files);
  const path = builtCircuitJsonPath(sourcePath, projectDir);
  if (path === null) return null;
  const sharesOutput = Object.keys(files).some(
    (other) =>
      other !== sourcePath && builtCircuitJsonPath(other, projectDirOf(other, files)) === path,
  );
  return sharesOutput ? null : { projectDir, path };
}

/** The live build location and source hash; ambiguous output paths are never considered current. */
export function expectedBuild(
  sourcePath: string,
  hashedFiles: Files,
): { readonly path: string; readonly sourceHash: string } | null {
  const output = circuitBuildOutput(sourcePath, hashedFiles);
  return output === null
    ? null
    : { path: output.path, sourceHash: sourceFilesystemHash(hashedFiles, output.projectDir) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The source hash a build's Circuit JSON carries. Null for a build an older CLI wrote without
 * one, and for text that is not Circuit JSON, such as a file that is still being written.
 */
function sourceHashOfBuild(circuitJsonText: string): string | null {
  let elements: unknown;
  try {
    elements = JSON.parse(circuitJsonText);
  } catch {
    return null;
  }
  if (!Array.isArray(elements)) return null;
  for (const element of elements) {
    if (!isRecord(element) || element.type !== "source_project_metadata") continue;
    const hash = element.source_filesystem_md5_hash;
    if (typeof hash === "string") return hash;
  }
  return null;
}

/** Whether this Circuit JSON is a build of the sources with this hash. */
export const isBuildOfSources = (circuitJsonText: string, sourceHash: string): boolean =>
  // A search tells most builds that are out of date, without parsing megabytes of JSON.
  circuitJsonText.includes(sourceHash) && sourceHashOfBuild(circuitJsonText) === sourceHash;
