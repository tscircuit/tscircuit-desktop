/**
 * tscircuit desktop: builds up to 0.1.3 installed the command as `t3`, T3 Code's name. This
 * removes that link and launcher. A link is removed only when it leads to this data folder's
 * launcher and the launcher has this app's marker, so T3 Code's own `t3` is never touched.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import type * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";

const { logInfo, logWarning } = makeComponentLogger("legacy-t3-command");

type Environment = Pick<
  DesktopEnvironment.DesktopEnvironment["Service"],
  "path" | "platform" | "homeDirectory" | "baseDir" | "stateDir"
>;

/** How every launcher this app has written starts, whatever the command was called. */
const MARKER = "Written by tscircuit desktop";

/** Present from the removal of the old command until the new one is installed. */
const pendingMarker = (environment: Environment) =>
  environment.path.join(environment.stateDir, "cli-command-rename-pending");

const linkFolders = (environment: Environment) => {
  const home = environment.homeDirectory;
  const user = [`${home}/.local/bin`, `${home}/bin`];
  return environment.platform === "darwin"
    ? [...user, "/opt/homebrew/bin", "/usr/local/bin"]
    : user;
};

/**
 * Removes this app's old `t3` command. True when the command was installed under the old name
 * and is still to be installed under the new one.
 */
export const remove = Effect.fn("legacyT3Command.remove")(function* (environment: Environment) {
  const fs = yield* FileSystem.FileSystem;
  const { path } = environment;
  const windows = environment.platform === "win32";
  const launcher = path.join(environment.baseDir, "bin", windows ? "t3.cmd" : "t3");
  const pending = pendingMarker(environment);

  const ours = yield* fs.readFileString(launcher).pipe(
    Effect.map((content) => content.includes(MARKER)),
    Effect.orElseSucceed(() => false),
  );
  if (!ours) return yield* fs.exists(pending).pipe(Effect.orElseSucceed(() => false));

  let hadCommand = false;
  // On Windows the launcher's folder is on PATH and the new launcher is written beside it.
  for (const folder of windows ? [] : linkFolders(environment)) {
    const link = path.join(folder, "t3");
    const target = yield* fs.readLink(link).pipe(Effect.option);
    if (Option.getOrUndefined(target) !== launcher) continue;
    const removed = yield* fs.remove(link).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (!removed) {
      // Left as it is, launcher included, so the link keeps working and the next launch retries.
      yield* logWarning("could not remove the old t3 command", { link });
      return yield* fs.exists(pending).pipe(Effect.orElseSucceed(() => false));
    }
    hadCommand = true;
    yield* logInfo("removed the old t3 command", { link });
  }
  if (hadCommand) yield* fs.writeFileString(pending, "").pipe(Effect.ignore);
  yield* fs.remove(launcher).pipe(Effect.ignore);
  return hadCommand || (yield* fs.exists(pending).pipe(Effect.orElseSucceed(() => false)));
});

/** Installs the command under its new name, for an install that had the old one. */
export const reinstall = Effect.fn("legacyT3Command.reinstall")(
  function* <E>(environment: Environment, install: Effect.Effect<unknown, E>) {
    const fs = yield* FileSystem.FileSystem;
    yield* install;
    yield* fs.remove(pendingMarker(environment)).pipe(Effect.ignore);
    yield* logInfo("installed the command under its new name");
  },
  Effect.catch(() => logWarning("could not install the command under its new name")),
);
