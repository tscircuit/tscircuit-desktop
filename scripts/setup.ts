/**
 * Builds the working copy of the app in .t3code/:
 *
 *   1. check out upstream T3 Code at the commit pinned in upstream.json
 *   2. apply the find-and-replace rules in renames.json
 *   3. copy overlay/ on top (files that only exist here, and replaced binaries)
 *   4. apply patches/ (our changes to upstream's own files)
 *   5. install dependencies
 *
 * Usage: node scripts/setup.ts [--force] [--no-install]
 *
 * Exit codes: 0 ready, 1 error, 3 one or more patches need a manual merge.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { checkoutExists, git, tryGit } from "./lib/checkout.ts"
import { fail, run, step, tryRun } from "./lib/exec.ts"
import { upstreamPathOf } from "./lib/patch-files.ts"
import {
  BASE_TAG,
  checkoutDir,
  overlayDir,
  patchesDir,
  PIN_TAG,
  renamesFile,
  SAVED_TAG,
  WORK_BRANCH,
} from "./lib/paths.ts"
import { readPin } from "./lib/pin.ts"
import { applyRenames, readRenames } from "./lib/renames.ts"

const CONFLICT_EXIT_CODE = 3

const flags = new Set(process.argv.slice(2))
const pin = readPin()

if (!checkoutExists()) {
  step(`Creating ${checkoutDir}`)
  mkdirSync(checkoutDir, { recursive: true })
  run("git", ["init", "--quiet", checkoutDir])
  git("remote", "add", "origin", pin.repository)
} else {
  git("remote", "set-url", "origin", pin.repository)
  if (!flags.has("--force")) refuseToDiscardUnsavedWork()
}

if (!tryGit("cat-file", "-e", `${pin.commit}^{commit}`).ok) {
  step(`Fetching T3 Code at ${pin.commit.slice(0, 10)}`)
  git("fetch", "--quiet", "--depth", "1", "origin", pin.commit)
}

step("Checking out the pinned commit")
git("checkout", "--quiet", "--force", "-B", WORK_BRANCH, pin.commit)
// Removes leftovers from the previous pin but keeps ignored files such as node_modules.
git("clean", "--quiet", "-fd")
git("tag", "--force", PIN_TAG, pin.commit)

const renames = readRenames(renamesFile)
if (renames) {
  const tracked = git("ls-files", "-z", "--", ...renames.paths)
    .split("\0")
    .filter(Boolean)
  const result = applyRenames(checkoutDir, tracked, renames)
  if (result.unmatched.length > 0) {
    fail(
      "These rules in renames.json no longer match anything in T3 Code:\n" +
        result.unmatched.map((label) => `  ${label}`).join("\n") +
        "\n\nUpstream has probably reworded what they were written for. Find the new\n" +
        "wording in .t3code/ and update the rule, or delete it if it is not needed.",
    )
  }
  step(`Renamed names in ${result.touched} files (renames.json)`)
  git("add", "--all")
  git("commit", "--quiet", "--allow-empty", "--no-verify", "-m", "tscircuit desktop: renames")
}
// overlay/ and patches/ are measured from here, so a rename is never a patch.
git("tag", "--force", BASE_TAG)

if (existsSync(overlayDir)) {
  step("Copying overlay/")
  cpSync(overlayDir, checkoutDir, { recursive: true })
}

const patches = existsSync(patchesDir)
  ? readdirSync(patchesDir)
      .filter((name) => name.endsWith(".patch"))
      .sort()
  : []
const conflicts: string[] = []
for (const patch of patches) {
  // --3way falls back to a real merge when upstream changed nearby lines, and
  // leaves ordinary conflict markers when it cannot merge on its own.
  const applied = tryGit("apply", "--3way", "--whitespace=nowarn", join(patchesDir, patch))
  if (!applied.ok) conflicts.push(patch)
}
step(`Applied ${patches.length - conflicts.length} of ${patches.length} patches`)

if (conflicts.length > 0) {
  const files = conflicts.map((patch) => `  ${upstreamPathOf(patch)}`).join("\n")
  fail(
    `These upstream files changed in a way our patches could not follow:\n${files}\n\n` +
      "Open each one in .t3code/, resolve the conflict markers (or redo the change),\n" +
      "then run `npm run export` to save the updated patches.",
    CONFLICT_EXIT_CODE,
  )
}

git("add", "--all")
git("commit", "--quiet", "--allow-empty", "--no-verify", "-m", "tscircuit desktop: overlay and patches")
git("tag", "--force", SAVED_TAG)

if (flags.has("--no-install")) {
  console.log("\nCheckout built. Dependencies were not installed (--no-install).")
} else {
  installDependencies()
  console.log("\nReady. Start the app with `npm run dev`.")
}

function refuseToDiscardUnsavedWork() {
  if (!tryGit("rev-parse", "--verify", "--quiet", SAVED_TAG).ok) return
  git("add", "--all")
  if (tryGit("diff", "--cached", "--quiet", SAVED_TAG).ok) return
  fail(
    "The checkout in .t3code/ has changes that are not saved in this repo.\n" +
      "Run `npm run export` to save them, or `npm run setup -- --force` to throw them away.",
  )
}

function installDependencies() {
  const manifest = JSON.parse(readFileSync(join(checkoutDir, "package.json"), "utf8")) as {
    engines?: { node?: string }
    packageManager?: string
  }
  const wantedNode = manifest.engines?.node
  if (wantedNode && /^\d+\.\d+\.\d+$/.test(wantedNode) && process.versions.node !== wantedNode) {
    fail(
      `T3 Code at this commit needs Node ${wantedNode}; this is Node ${process.versions.node}.\n` +
        "Switch versions and run `npm run setup` again (the checkout itself is ready).",
    )
  }

  const pnpmVersion = manifest.packageManager?.match(/^pnpm@([\w.-]+)/)?.[1]
  const candidates: Array<[string, string[]]> = [
    ["pnpm", []],
    ["corepack", ["pnpm"]],
    ["npx", ["--yes", `pnpm@${pnpmVersion ?? "latest"}`]],
  ]
  const [command, prefix] =
    candidates.find(([bin, args]) => tryRun(bin, [...args, "--version"], { cwd: checkoutDir }).ok) ??
    fail("Could not find pnpm, corepack or npx to install dependencies.")

  step(`Installing dependencies with ${[command, ...prefix].join(" ")}`)
  run(command, [...prefix, "install", "--frozen-lockfile"], { cwd: checkoutDir, inherit: true })
}
