/**
 * Bundles an agent skill into the app.
 *
 * `setup` downloads the skill repository named in skill.json at its newest
 * commit and writes every file into one JSON file inside the checkout. The
 * server imports that file and, when it starts, installs the skill where
 * agents look for skills (see overlay/apps/server/src/tscircuit/bundledSkill.ts).
 *
 * The JSON is generated, not saved: it is listed in the checkout's
 * .git/info/exclude, so `export` never copies it into overlay/. Each build
 * therefore ships whatever the skill repository holds on the day it is built.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { step, tryRun } from "./exec.ts"
import { checkoutDir, skillFile } from "./paths.ts"

/** The contents of skill.json. */
export interface SkillSource {
  /** The folder name agents know the skill by. */
  name: string
  /** Git URL of the skill's repository. */
  repository: string
  branch: string
  /** Where in the checkout the generated JSON goes. */
  into: string
}

/** Null when this repo bundles no skill (there is no skill.json). */
export const readSkillSource = (): SkillSource | null =>
  existsSync(skillFile) ? (JSON.parse(readFileSync(skillFile, "utf8")) as SkillSource) : null

interface BundledSkill {
  /** The folder name agents know the skill by. */
  name: string
  repository: string
  /** The skill repository commit the files came from. Null means nothing is bundled. */
  commit: string | null
  files: Array<{ path: string; content: string; executable: boolean }>
}

const EXECUTABLE_MODE = "100755"
const REGULAR_MODES = new Set(["100644", EXECUTABLE_MODE])

/** Keeps the generated file out of `git add --all`, which `export` relies on. */
function excludeFromCheckoutGit(path: string): void {
  const excludeFile = join(checkoutDir, ".git", "info", "exclude")
  const current = existsSync(excludeFile) ? readFileSync(excludeFile, "utf8") : ""
  if (current.split("\n").includes(`/${path}`)) return
  mkdirSync(dirname(excludeFile), { recursive: true })
  appendFileSync(excludeFile, `${current.endsWith("\n") || current === "" ? "" : "\n"}/${path}\n`)
}

function readSkill(source: SkillSource): BundledSkill | null {
  const clone = mkdtempSync(join(tmpdir(), "tscircuit-desktop-skill-"))
  try {
    const cloned = tryRun("git", [
      "clone", "--quiet", "--depth", "1", "--branch", source.branch, source.repository, clone,
    ])
    if (!cloned.ok) return null
    const git = (...args: string[]) => tryRun("git", args, { cwd: clone }).stdout
    const commit = git("rev-parse", "HEAD").trim()
    const files = git("ls-files", "--stage", "-z")
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const [meta = "", path = ""] = entry.split("\t")
        return { mode: meta.split(" ")[0] ?? "", path }
      })
      // Submodules and symlinks are skipped, as are dotfiles such as .gitignore.
      .filter(({ mode, path }) => REGULAR_MODES.has(mode) && !path.split("/").some((part) => part.startsWith(".")))
      .map(({ mode, path }) => ({
        path,
        content: readFileSync(join(clone, path), "utf8"),
        executable: mode === EXECUTABLE_MODE,
      }))
    return { name: source.name, repository: source.repository, commit, files }
  } finally {
    rmSync(clone, { recursive: true, force: true })
  }
}

/** Writes the bundled-skill JSON into the checkout. Never fails the build. */
export function bundleSkill(source: SkillSource): void {
  excludeFromCheckoutGit(source.into)
  const target = join(checkoutDir, source.into)
  const skill = readSkill(source)
  if (skill) {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${JSON.stringify(skill, null, 2)}\n`)
    step(`Bundled the ${skill.name} skill at ${skill.commit?.slice(0, 10)} (${skill.files.length} files)`)
    return
  }
  if (existsSync(target)) {
    step(`Could not download ${source.repository}; keeping the skill bundled earlier`)
    return
  }
  // The server imports this file, so it has to exist even when there is no network.
  const empty: BundledSkill = { name: source.name, repository: source.repository, commit: null, files: [] }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(empty, null, 2)}\n`)
  step(`Could not download ${source.repository}; this build has no bundled skill`)
}
