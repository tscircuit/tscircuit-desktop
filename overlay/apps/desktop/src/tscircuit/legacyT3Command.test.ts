import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as LegacyT3Command from "./legacyT3Command.ts";

const OURS = "#!/bin/sh\n# Written by tscircuit desktop: runs the desktop app's bundled t3 CLI.\n";
const T3_CODE = "#!/bin/sh\n# Written by T3 Code: runs the desktop app's bundled t3 CLI.\n";

/** A home with this app's data folder and an old `t3` launcher holding `launcher`. */
const setUp = (launcher: string | undefined, platform: NodeJS.Platform = "darwin") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "legacy-t3-command-" });
    const baseDir = path.join(home, ".tscircuit-desktop");
    const stateDir = path.join(baseDir, "userdata");
    const bin = path.join(home, ".local", "bin");
    yield* fs.makeDirectory(stateDir, { recursive: true });
    yield* fs.makeDirectory(path.join(baseDir, "bin"), { recursive: true });
    yield* fs.makeDirectory(bin, { recursive: true });
    const oldLauncher = path.join(baseDir, "bin", platform === "win32" ? "t3.cmd" : "t3");
    if (launcher !== undefined) yield* fs.writeFileString(oldLauncher, launcher);
    const environment = { path, platform, homeDirectory: home, baseDir, stateDir };
    return { fs, path, home, bin, oldLauncher, environment };
  });

it.layer(NodeServices.layer)("legacyT3Command", (it) => {
  it.effect("removes this app's old t3 link and launcher and asks for a reinstall", () =>
    Effect.gen(function* () {
      const { fs, path, bin, oldLauncher, environment } = yield* setUp(OURS);
      yield* fs.symlink(oldLauncher, path.join(bin, "t3"));

      expect(yield* LegacyT3Command.remove(environment)).toBe(true);
      expect(yield* fs.readLink(path.join(bin, "t3")).pipe(Effect.option)).toMatchObject({
        _tag: "None",
      });
      expect(yield* fs.exists(oldLauncher)).toBe(false);

      // Still wanted on the next launch, until the new command is installed.
      expect(yield* LegacyT3Command.remove(environment)).toBe(true);
      let installs = 0;
      yield* LegacyT3Command.reinstall(
        environment,
        Effect.sync(() => {
          installs += 1;
        }),
      );
      expect(installs).toBe(1);
      expect(yield* LegacyT3Command.remove(environment)).toBe(false);
    }),
  );

  it.effect("keeps asking when the new command could not be installed", () =>
    Effect.gen(function* () {
      const { fs, path, bin, oldLauncher, environment } = yield* setUp(OURS);
      yield* fs.symlink(oldLauncher, path.join(bin, "t3"));
      expect(yield* LegacyT3Command.remove(environment)).toBe(true);

      yield* LegacyT3Command.reinstall(environment, Effect.fail("another command is in the way"));
      expect(yield* LegacyT3Command.remove(environment)).toBe(true);
    }),
  );

  it.effect("leaves T3 Code's t3 command alone", () =>
    Effect.gen(function* () {
      const { fs, path, home, bin, oldLauncher, environment } = yield* setUp(OURS);
      const theirs = path.join(home, ".t3", "bin", "t3");
      yield* fs.makeDirectory(path.dirname(theirs), { recursive: true });
      yield* fs.writeFileString(theirs, T3_CODE);
      yield* fs.symlink(theirs, path.join(bin, "t3"));

      // Our old launcher goes, but there was no link of ours, so nothing is reinstalled.
      expect(yield* LegacyT3Command.remove(environment)).toBe(false);
      expect(yield* fs.readLink(path.join(bin, "t3"))).toBe(theirs);
      expect(yield* fs.readFileString(theirs)).toBe(T3_CODE);
      expect(yield* fs.exists(oldLauncher)).toBe(false);
    }),
  );

  it.effect("leaves a t3 launcher in the data folder that this app did not write", () =>
    Effect.gen(function* () {
      const { fs, path, bin, oldLauncher, environment } = yield* setUp(T3_CODE);
      yield* fs.symlink(oldLauncher, path.join(bin, "t3"));

      expect(yield* LegacyT3Command.remove(environment)).toBe(false);
      expect(yield* fs.readLink(path.join(bin, "t3"))).toBe(oldLauncher);
      expect(yield* fs.readFileString(oldLauncher)).toBe(T3_CODE);
    }),
  );

  it.effect("does nothing on an install that never had the old command", () =>
    Effect.gen(function* () {
      const { fs, path, bin, environment } = yield* setUp(undefined);
      yield* fs.writeFileString(path.join(bin, "t3"), "someone else's t3");

      expect(yield* LegacyT3Command.remove(environment)).toBe(false);
      expect(yield* fs.readFileString(path.join(bin, "t3"))).toBe("someone else's t3");
    }),
  );

  it.effect("on Windows removes the old launcher and needs no reinstall", () =>
    Effect.gen(function* () {
      const { fs, oldLauncher, environment } = yield* setUp(`@echo off\r\nrem ${OURS}`, "win32");

      expect(yield* LegacyT3Command.remove(environment)).toBe(false);
      expect(yield* fs.exists(oldLauncher)).toBe(false);
    }),
  );
});
