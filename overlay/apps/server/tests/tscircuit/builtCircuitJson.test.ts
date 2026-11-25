import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../src/config.ts";
import * as VcsDriverRegistry from "../../src/vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../../src/vcs/VcsProcess.ts";
import * as KnownWorkspaces from "../../src/workspace/KnownWorkspaces.ts";
import * as WorkspaceEntries from "../../src/workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../../src/workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../../src/workspace/WorkspacePaths.ts";
import { readFileMaxBytes } from "../../src/tscircuit/builtCircuitJson.ts";

const USUAL_MAX_BYTES = 1024 * 1024;

describe("readFileMaxBytes", () => {
  it.each([
    "dist/main-board/circuit.json",
    "packages/usb/dist/boards/usb/circuit.json",
    "dist\\main-board\\circuit.json",
    "/Users/me/phone/dist/main-board/circuit.json",
  ])("lets the build output %s past the usual limit", (path) => {
    expect(readFileMaxBytes(path, USUAL_MAX_BYTES)).toBeGreaterThan(USUAL_MAX_BYTES);
  });

  it.each([
    "main-board.circuit.tsx",
    "circuit.json",
    "dist/main-board/pcb.svg",
    "dist/main-board/circuit.json.bak",
    "src/redist/circuit.json",
  ])("keeps the usual limit for %s", (path) => {
    expect(readFileMaxBytes(path, USUAL_MAX_BYTES)).toBe(USUAL_MAX_BYTES);
  });
});

const layerTest = Layer.empty.pipe(
  Layer.provideMerge(
    WorkspaceFileSystem.layer.pipe(
      Layer.provide(
        Layer.mock(KnownWorkspaces.KnownWorkspaces)({ assertContains: () => Effect.void }),
      ),
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer))),
    ),
  ),
  Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provideMerge(
    ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-built-circuit-test-" }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

it.layer(layerTest, { excludeTestServices: true })("reading a project's files", (it) => {
  it.effect("returns a build's Circuit JSON whole, and cuts other large files short", () =>
    Effect.gen(function* () {
      const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-built-circuit-" });
      const circuitJson = JSON.stringify([{ type: "pcb_note", text: "x".repeat(3_000_000) }]);
      yield* fileSystem.makeDirectory(path.join(cwd, "dist", "main-board"), { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(cwd, "dist", "main-board", "circuit.json"),
        circuitJson,
      );
      yield* fileSystem.writeFileString(path.join(cwd, "notes.json"), circuitJson);

      const built = yield* workspaceFileSystem.readFile({
        cwd,
        relativePath: "dist/main-board/circuit.json",
      });
      const other = yield* workspaceFileSystem.readFile({ cwd, relativePath: "notes.json" });

      expect(built.truncated).toBe(false);
      expect(built.contents).toBe(circuitJson);
      expect(other.truncated).toBe(true);
      expect(other.contents).toHaveLength(USUAL_MAX_BYTES);
    }),
  );
});
