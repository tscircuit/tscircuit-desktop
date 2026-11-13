/**
 * Moves the pin to a newer upstream commit and re-applies our changes.
 *
 * Usage: node scripts/bump.ts [commit]
 *
 * Without a commit it takes the tip of the branch named in upstream.json.
 * When every patch still applies, overlay/ and patches/ are refreshed and the
 * result is ready to commit. When one does not, the pin stays moved and the
 * conflict is left in .t3code/ for you to resolve, then `npm run export`.
 *
 * Exit codes: 0 bumped or already current, 1 error, 3 patches need a manual merge.
 */
import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { fail, run, step } from "./lib/exec.ts"
import { repoRoot } from "./lib/paths.ts"
import { compareUrl, readPin, writePin } from "./lib/pin.ts"

const pin = readPin()
const target = process.argv[2] ?? latestUpstreamCommit()

if (target === pin.commit) {
  console.log(`Already at ${pin.commit.slice(0, 10)}, the tip of ${pin.branch}.`)
  report({ changed: "false" })
  process.exit(0)
}

step(`Moving the pin ${pin.commit.slice(0, 10)} → ${target.slice(0, 10)}`)
const changes = compareUrl(pin, pin.commit, target)
writePin({ ...pin, commit: target })
report({ changed: "true", from: pin.commit, to: target, compare: changes })

const setup = runScript("setup.ts", "--no-install")
if (setup !== 0) {
  console.error(`upstream.json now points at ${target}. What upstream changed:\n  ${changes}`)
  process.exit(setup)
}

// Rewrites the patches against the new upstream so their context stays fresh.
const exported = runScript("export.ts")
if (exported !== 0) process.exit(exported)

console.log(`\nBumped. What upstream changed:\n  ${changes}`)
console.log("Run `npm run setup` to install any new dependencies, then test and commit.")

function latestUpstreamCommit(): string {
  const output = run("git", ["ls-remote", pin.repository, `refs/heads/${pin.branch}`])
  const commit = output.split(/\s+/)[0]
  if (!commit) fail(`Could not find branch ${pin.branch} in ${pin.repository}.`)
  return commit
}

function runScript(name: string, ...args: string[]): number {
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", name), ...args], {
    stdio: "inherit",
  })
  return result.status ?? 1
}

/** Lets a GitHub Actions workflow read the outcome as step outputs. */
function report(values: Record<string, string>): void {
  const outputFile = process.env.GITHUB_OUTPUT
  if (!outputFile) return
  for (const [key, value] of Object.entries(values)) {
    appendFileSync(outputFile, `${key}=${value}\n`)
  }
}
