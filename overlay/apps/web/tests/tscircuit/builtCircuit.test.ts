import { describe, expect, it } from "vite-plus/test";

import { expectedBuild, isBuildOfSources } from "../../src/tscircuit/builtCircuit";
import { type ProjectReader, readProject } from "../../src/tscircuit/projectFsMap";

const PROJECT: Record<string, string> = {
  "package.json": '{ "name": "phone" }\n',
  "main-board.circuit.tsx": 'export default () => <board width="10mm" height="10mm" />\n',
  "lid-board.circuit.tsx": "export default () => <board />\n",
  "lib/parts.tsx": 'export const R = () => <resistor name="R1" resistance="1k" />\n',
  "lib/hinge.ts": "export const hingeX = 12.5 // µm? no: mm\n",
  "imports/TS_1187A_B_A_B.tsx": "export const a = 1\n",
  "imports/TP4056_42_ESOP8.tsx": "export const b = 2\n",
  "imports/a7670e.tsx": "export const c = 3\n",
  "imports/A7670E_FASE.tsx": "export const d = 4\n",
  "imports/Zeta.tsx": "export const e = 5\n",
  "imports/alpha.tsx": "export const f = 6\n",
  "lib.ts": 'export * from "./lib/parts"\n',
  "README.md": "# Flip phone\n",
  "notes.txt": "",
  ".eslintrc.json": "{}\n",
  "tsconfig.json": "{}\n",
  // `tsci build` leaves these out of its hash.
  "bun.lock": "lock\n",
  "photo.png": "png\n",
  "old.circuit.json": "[]\n",
  "dist/main-board/circuit.json": "[]\n",
  "node_modules/tscircuit/index.js": "x\n",
  ".tscircuit/cache/a.json": "{}\n",
  "build/out.js": "x\n",
  // A project of its own, with its own package.json.
  "packages/usb/package.json": '{ "name": "usb" }\n',
  "packages/usb/usb.board.tsx": "export default () => <board />\n",
  "packages/usb/lib/pins.ts": "export const pins = 4\n",
};

/** Reads a project held in memory the way the environment reads one from disk. */
function readerOf(
  files: Record<string, string>,
  options: { readonly ignored?: ReadonlyArray<string> } = {},
): ProjectReader {
  const isIgnored = (path: string) =>
    (options.ignored ?? []).some((ignored) => path === ignored || path.startsWith(`${ignored}/`));
  return {
    list: async (directoryPath) => {
      const prefix = directoryPath === "" ? "" : `${directoryPath}/`;
      const entries = new Map<string, "file" | "directory">();
      for (const path of Object.keys(files)) {
        if (!path.startsWith(prefix)) continue;
        const [name, ...rest] = path.slice(prefix.length).split("/");
        entries.set(`${prefix}${name}`, rest.length === 0 ? "file" : "directory");
      }
      return {
        entries: [...entries].map(([path, kind]) => ({ path, kind, ignored: isIgnored(path) })),
        truncated: false,
      };
    },
    read: async (relativePath) => {
      const contents = files[relativePath] ?? "";
      return { contents, byteLength: new TextEncoder().encode(contents).length, truncated: false };
    },
  };
}

describe("the build expected of a file", () => {
  // The hashes are what tscircuit/cli's getSourceFilesystemMd5Hash gives these files.
  it("is where tsci build writes it, with the hash tsci build gives the sources", async () => {
    const project = await readProject(readerOf(PROJECT, { ignored: ["dist", "node_modules"] }));
    const hashedFiles = project.hashedFiles ?? {};
    expect(expectedBuild("main-board.circuit.tsx", hashedFiles)).toEqual({
      path: "dist/main-board/circuit.json",
      sourceHash: "1b412781061f91361e45c2f9eef2f12e",
    });
    // A folder with a package.json is a project of its own to the CLI.
    expect(expectedBuild("packages/usb/usb.board.tsx", hashedFiles)).toEqual({
      path: "packages/usb/dist/usb/circuit.json",
      sourceHash: "74bb032244425a73dd9c6a123b96b5e0",
    });
  });

  it("has a hash that changes with any source file, and not with the build's own output", async () => {
    const hashOf = async (files: Record<string, string>) =>
      expectedBuild(
        "main-board.circuit.tsx",
        (await readProject(readerOf(files))).hashedFiles ?? {},
      )?.sourceHash;
    const before = await hashOf(PROJECT);
    expect(await hashOf({ ...PROJECT, "dist/lid-board/circuit.json": "[]\n" })).toBe(before);
    expect(await hashOf({ ...PROJECT, "README.md": "# Flip phone, v2\n" })).not.toBe(before);
    expect(await hashOf({ ...PROJECT, "lib/hinge.ts": "export const hingeX = 13\n" })).not.toBe(
      before,
    );
  });

  it.each([
    ["index.tsx", "dist/index/circuit.json"],
    ["boards/usb.board.tsx", "dist/boards/usb/circuit.json"],
    ["lib/hinge.ts", undefined],
  ])("for %s is at %s", (sourcePath, path) => {
    expect(expectedBuild(sourcePath, PROJECT)?.path).toBe(path);
  });

  it("is none for a file whose output another file also builds to", () => {
    const files = { ...PROJECT, "main-board.tsx": "export default () => <board />\n" };
    expect(expectedBuild("main-board.circuit.tsx", files)).toBeNull();
    expect(expectedBuild("lid-board.circuit.tsx", files)).not.toBeNull();
  });
});

describe("reading a project for its hash", () => {
  it("leaves what the viewer is sent as it was", async () => {
    const files = { ...PROJECT, "generated/part.tsx": "export const g = 7\n" };
    const project = await readProject(
      readerOf(files, { ignored: ["dist", "node_modules", "generated"] }),
    );
    // Source that git ignores is built from, and so hashed, but not sent to the viewer.
    expect(project.hashedFiles).toHaveProperty(["generated/part.tsx"]);
    expect(Object.keys(project.fsMap).toSorted()).toEqual(
      [
        "imports/A7670E_FASE.tsx",
        "imports/TP4056_42_ESOP8.tsx",
        "imports/TS_1187A_B_A_B.tsx",
        "imports/Zeta.tsx",
        "imports/a7670e.tsx",
        "imports/alpha.tsx",
        "lib.ts",
        "lib/hinge.ts",
        "lib/parts.tsx",
        "lid-board.circuit.tsx",
        "main-board.circuit.tsx",
        "old.circuit.json",
        "package.json",
        "packages/usb/lib/pins.ts",
        "packages/usb/package.json",
        "packages/usb/usb.board.tsx",
        "tsconfig.json",
      ].toSorted(),
    );
    expect(project.truncated).toBe(false);
  });

  it.each<[string, Awaited<ReturnType<ProjectReader["read"]>>]>([
    ["cannot be read", null],
    ["is cut short", { contents: "# Flip", byteLength: 4_000_000, truncated: true }],
    // A byte order mark is dropped from the text, so the bytes the CLI hashed are not known.
    [
      "does not encode back to its bytes",
      { contents: "# Flip phone\n", byteLength: 16, truncated: false },
    ],
  ])("has no hash to compare when a hashed file %s", async (_name, readme) => {
    const reader = readerOf(PROJECT);
    const project = await readProject({
      ...reader,
      read: (path) => (path === "README.md" ? Promise.resolve(readme) : reader.read(path)),
    });
    expect(project.hashedFiles).toBeNull();
    // The viewer never wanted the README, so it still gets every file.
    expect(project.fsMap).toHaveProperty(["main-board.circuit.tsx"]);
    expect(project.truncated).toBe(false);
  });
});

describe("isBuildOfSources", () => {
  const hash = "1b412781061f91361e45c2f9eef2f12e";
  const build = (metadata: object) =>
    JSON.stringify([{ type: "pcb_board", pcb_board_id: "pcb_board_0" }, metadata]);

  it("takes a build that carries the hash of the sources", () => {
    expect(
      isBuildOfSources(
        build({ type: "source_project_metadata", source_filesystem_md5_hash: hash }),
        hash,
      ),
    ).toBe(true);
  });

  it.each([
    [
      "a build of other sources",
      build({ type: "source_project_metadata", source_filesystem_md5_hash: "0".repeat(32) }),
    ],
    ["a build from a CLI that wrote no hash", build({ type: "source_project_metadata" })],
    ["the hash somewhere other than the project's metadata", build({ type: "note", text: hash })],
    ["a file that is still being written", `[{"source_filesystem_md5_hash":"${hash}"`],
    ["JSON that is not Circuit JSON", JSON.stringify({ source_filesystem_md5_hash: hash })],
  ])("turns down %s", (_name, text) => {
    expect(isBuildOfSources(text, hash)).toBe(false);
  });
});
