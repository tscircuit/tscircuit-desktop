import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import generated from "./bundledSkill.generated.json" with { type: "json" };

/** tscircuit desktop: an agent skill carried inside the app. `npm run setup` writes the JSON. */
export interface BundledSkill {
  readonly name: string;
  /** The skill repository commit the files came from. Null means nothing is bundled. */
  readonly commit: string | null;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
    readonly executable: boolean;
  }>;
}

type InstallOutcome = "installed" | "current" | "left-alone";

/** Written into a folder this app installed, holding the commit, so it never touches yours. */
const MARKER_FILE = ".installed-by-tscircuit-desktop";

const isSafeRelativePath = (path: string) =>
  path.length > 0 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  path.split("/").every((part) => part !== "" && part !== "." && part !== "..");

/**
 * Installs the skill where agents look for skills in the user's home folder:
 * ~/.agents/skills (Codex and most other agents) and ~/.claude/skills (Claude Code).
 * A folder of the same name without our marker is the user's own copy and is left alone.
 */
export const installSkill = Effect.fn("tscircuit.installSkill")(function* (
  skill: BundledSkill,
  homeDirectory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const outcomes: Array<{ readonly directory: string; readonly outcome: InstallOutcome }> = [];
  const files = skill.files.filter((file) => isSafeRelativePath(file.path));
  if (skill.commit === null || files.length === 0 || !isSafeRelativePath(skill.name)) {
    return outcomes;
  }

  for (const agentFolder of [".agents", ".claude"]) {
    const directory = path.join(homeDirectory, agentFolder, "skills", skill.name);
    const markerPath = path.join(directory, MARKER_FILE);
    const installedCommit = yield* fileSystem.readFileString(markerPath).pipe(Effect.option);
    if (Option.isNone(installedCommit)) {
      if (yield* fileSystem.exists(directory)) {
        outcomes.push({ directory, outcome: "left-alone" });
        continue;
      }
    } else if (installedCommit.value.trim() === skill.commit) {
      outcomes.push({ directory, outcome: "current" });
      continue;
    } else {
      yield* fileSystem.remove(directory, { recursive: true, force: true });
    }

    for (const file of files) {
      const target = path.join(directory, file.path);
      yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true });
      yield* fileSystem.writeFileString(target, file.content);
      if (file.executable) yield* fileSystem.chmod(target, 0o755);
    }
    // Written last: a half-written folder has no marker and is not mistaken for a finished one.
    yield* fileSystem.writeFileString(markerPath, `${skill.commit}\n`);
    outcomes.push({ directory, outcome: "installed" });
  }
  return outcomes;
});

/** Installs the skill this build carries. A failure is logged and never stops the server. */
export const installBundledSkill = Effect.gen(function* () {
  const outcomes = yield* installSkill(generated, yield* HostProcess.HomeDirectory);
  for (const { directory, outcome } of outcomes) {
    if (outcome === "installed") {
      yield* Effect.logInfo("Installed the bundled tscircuit skill", {
        directory,
        commit: generated.commit,
      });
    }
  }
}).pipe(
  Effect.catch((cause) =>
    Effect.logWarning("Could not install the bundled tscircuit skill", { cause }),
  ),
);
