import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { assert } from "vite-plus/test";

import { type BundledSkill, installSkill } from "./bundledSkill.ts";

const skill = (commit: string, body: string): BundledSkill => ({
  name: "tscircuit",
  commit,
  files: [
    { path: "SKILL.md", content: body, executable: false },
    { path: "scripts/check.sh", content: "#!/bin/sh\n", executable: true },
  ],
});

const withHome = <A, E>(
  use: (home: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* use(yield* fileSystem.makeTempDirectoryScoped({ prefix: "bundled-skill-" }));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect("installs the skill for both agent folders, then leaves a current copy alone", () =>
  withHome((home) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const first = yield* installSkill(skill("abc", "one"), home);
      assert.deepEqual(
        first.map((entry) => entry.outcome),
        ["installed", "installed"],
      );
      for (const agentFolder of [".agents", ".claude"]) {
        const directory = path.join(home, agentFolder, "skills", "tscircuit");
        assert.equal(yield* fileSystem.readFileString(path.join(directory, "SKILL.md")), "one");
        const script = yield* fileSystem.stat(path.join(directory, "scripts", "check.sh"));
        assert.equal(script.mode & 0o111, 0o111);
      }

      const second = yield* installSkill(skill("abc", "one"), home);
      assert.deepEqual(
        second.map((entry) => entry.outcome),
        ["current", "current"],
      );
    }),
  ),
);

it.effect("replaces its own older copy, including files the new skill dropped", () =>
  withHome((home) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = path.join(home, ".claude", "skills", "tscircuit");
      yield* installSkill(skill("abc", "one"), home);

      const newer: BundledSkill = {
        name: "tscircuit",
        commit: "def",
        files: [{ path: "SKILL.md", content: "two", executable: false }],
      };
      yield* installSkill(newer, home);

      assert.equal(yield* fileSystem.readFileString(path.join(directory, "SKILL.md")), "two");
      assert.isFalse(yield* fileSystem.exists(path.join(directory, "scripts", "check.sh")));
    }),
  ),
);

it.effect("never touches a skill folder the user installed themselves", () =>
  withHome((home) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const own = path.join(home, ".claude", "skills", "tscircuit");
      yield* fileSystem.makeDirectory(own, { recursive: true });
      yield* fileSystem.writeFileString(path.join(own, "SKILL.md"), "mine");

      const outcomes = yield* installSkill(skill("abc", "one"), home);

      assert.deepEqual(
        outcomes.map((entry) => entry.outcome),
        ["installed", "left-alone"],
      );
      assert.equal(yield* fileSystem.readFileString(path.join(own, "SKILL.md")), "mine");
    }),
  ),
);

it.effect("installs nothing when the build carries no skill, or a file path escapes", () =>
  withHome((home) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      assert.deepEqual(
        yield* installSkill({ name: "tscircuit", commit: null, files: [] }, home),
        [],
      );

      const escaping: BundledSkill = {
        name: "tscircuit",
        commit: "abc",
        files: [{ path: "../../escaped.txt", content: "x", executable: false }],
      };
      yield* installSkill(escaping, home);
      assert.isFalse(yield* fileSystem.exists(path.join(home, ".agents", "escaped.txt")));
      assert.isFalse(yield* fileSystem.exists(path.join(home, "escaped.txt")));
    }),
  ),
);
