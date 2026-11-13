/**
 * Exercises setup, export and bump end to end against a tiny stand-in for
 * upstream, so the workflow is tested without downloading T3 Code.
 */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { NOTE_PLACEHOLDER } from "./lib/patch-files.ts"

const UPSTREAM_FILE = `${["one", "two", "three", "four", "five", "six", "seven", "eight"].join("\n")}\n`

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" },
  )
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

/** A fake upstream with one commit, and a copy of these scripts pinned to it. */
function createSandbox(extraUpstreamFiles: Record<string, string | Buffer> = {}) {
  const root = mkdtempSync(join(tmpdir(), "tscircuit-desktop-test-"))
  const upstream = join(root, "upstream")
  const repo = join(root, "repo")
  const checkout = join(repo, ".t3code")

  mkdirSync(upstream)
  git(upstream, "init", "--quiet", "--initial-branch=main")
  // Lets a local path serve a single commit by hash, as GitHub does.
  git(upstream, "config", "uploadpack.allowAnySHA1InWant", "true")
  writeFileSync(join(upstream, "app.txt"), UPSTREAM_FILE)
  for (const [path, content] of Object.entries(extraUpstreamFiles)) {
    writeFileSync(join(upstream, path), content)
  }
  const commitUpstream = (message: string) => {
    git(upstream, "add", "--all")
    git(upstream, "commit", "--quiet", "-m", message)
    return git(upstream, "rev-parse", "HEAD")
  }
  const firstCommit = commitUpstream("first")

  mkdirSync(repo)
  cpSync(import.meta.dirname, join(repo, "scripts"), { recursive: true })
  writeFileSync(
    join(repo, "upstream.json"),
    JSON.stringify({ repository: upstream, branch: "main", commit: firstCommit }),
  )

  const script = (name: string, ...args: string[]) =>
    spawnSync(process.execPath, [join(repo, "scripts", `${name}.ts`), ...args], {
      encoding: "utf8",
    })
  const editUpstream = (from: string, to: string) => {
    const path = join(upstream, "app.txt")
    writeFileSync(path, readFileSync(path, "utf8").replace(from, to))
    return commitUpstream(`${from} to ${to}`)
  }
  const pinnedCommit = () =>
    (JSON.parse(readFileSync(join(repo, "upstream.json"), "utf8")) as { commit: string }).commit

  const writeRenames = (rules: Array<Record<string, string>>) =>
    writeFileSync(join(repo, "renames.json"), JSON.stringify({ paths: ["."], rules }))

  return { repo, checkout, script, editUpstream, pinnedCommit, writeRenames }
}

/** Makes the two kinds of change a contributor can make, then saves them. */
function makeAndExportChanges(sandbox: ReturnType<typeof createSandbox>) {
  const { repo, checkout, script } = sandbox
  assert.equal(script("setup", "--no-install").status, 0)
  writeFileSync(join(checkout, "added.txt"), "only in tscircuit desktop\n")
  writeFileSync(join(checkout, "app.txt"), UPSTREAM_FILE.replace("two", "TWO"))
  assert.equal(script("export").status, 0)

  const patch = join(repo, "patches", "app.txt.patch")
  writeFileSync(patch, readFileSync(patch, "utf8").replace(NOTE_PLACEHOLDER, "Shout line two."))
  return patch
}

test("export puts new files in overlay/ and edits to upstream files in patches/", () => {
  const sandbox = createSandbox()
  const { repo, checkout, script } = sandbox

  assert.equal(script("setup", "--no-install").status, 0)
  writeFileSync(join(checkout, "added.txt"), "only in tscircuit desktop\n")
  writeFileSync(join(checkout, "app.txt"), UPSTREAM_FILE.replace("two", "TWO"))
  assert.equal(script("export").status, 0)

  assert.equal(
    readFileSync(join(repo, "overlay", "added.txt"), "utf8"),
    "only in tscircuit desktop\n",
  )
  const patch = readFileSync(join(repo, "patches", "app.txt.patch"), "utf8")
  assert.match(patch, /^-two$/m)
  assert.match(patch, /^\+TWO$/m)
  assert.equal(existsSync(join(repo, "overlay", "app.txt")), false)
})

test("export --check fails until every patch says why it exists", () => {
  const sandbox = createSandbox()
  const { repo, checkout, script } = sandbox

  assert.equal(script("setup", "--no-install").status, 0)
  writeFileSync(join(checkout, "app.txt"), UPSTREAM_FILE.replace("two", "TWO"))
  assert.equal(script("export").status, 0)

  const unexplained = script("export", "--check")
  assert.equal(unexplained.status, 1)
  assert.match(unexplained.stderr, /need a note/)

  const patch = join(repo, "patches", "app.txt.patch")
  writeFileSync(patch, readFileSync(patch, "utf8").replace(NOTE_PLACEHOLDER, "Shout line two."))
  assert.equal(script("export", "--check").status, 0)

  // The note survives the diff being rewritten.
  assert.equal(script("export").status, 0)
  assert.match(readFileSync(patch, "utf8"), /^Shout line two\.$/m)
})

test("setup rebuilds the same tree from overlay/ and patches/", () => {
  const sandbox = createSandbox()
  const { checkout, script } = sandbox
  makeAndExportChanges(sandbox)

  assert.equal(script("setup", "--no-install", "--force").status, 0)

  assert.equal(readFileSync(join(checkout, "added.txt"), "utf8"), "only in tscircuit desktop\n")
  assert.equal(readFileSync(join(checkout, "app.txt"), "utf8"), UPSTREAM_FILE.replace("two", "TWO"))
  assert.equal(script("export", "--check").status, 0)
})

test("setup refuses to throw away work that was not exported", () => {
  const sandbox = createSandbox()
  const { checkout, script } = sandbox
  assert.equal(script("setup", "--no-install").status, 0)
  writeFileSync(join(checkout, "app.txt"), "unsaved work\n")

  const refused = script("setup", "--no-install")
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /not saved/)
  assert.equal(readFileSync(join(checkout, "app.txt"), "utf8"), "unsaved work\n")

  assert.equal(script("setup", "--no-install", "--force").status, 0)
  assert.equal(readFileSync(join(checkout, "app.txt"), "utf8"), UPSTREAM_FILE)
})

test("bump carries our patches across upstream changes elsewhere in the file", () => {
  const sandbox = createSandbox()
  const { checkout, script, editUpstream, pinnedCommit } = sandbox
  makeAndExportChanges(sandbox)
  const newCommit = editUpstream("seven", "SEPT")

  const bump = script("bump")

  assert.equal(bump.status, 0, bump.stderr)
  assert.equal(pinnedCommit(), newCommit)
  const merged = readFileSync(join(checkout, "app.txt"), "utf8")
  assert.match(merged, /^TWO$/m)
  assert.match(merged, /^SEPT$/m)
  assert.equal(script("export", "--check").status, 0)
})

test("bump stops for a manual merge when upstream rewrites a line we patch", () => {
  const sandbox = createSandbox()
  const { repo, checkout, script, editUpstream, pinnedCommit } = sandbox
  makeAndExportChanges(sandbox)
  const newCommit = editUpstream("two", "deux")

  const bump = script("bump")

  assert.equal(bump.status, 3)
  assert.match(bump.stderr, /app\.txt/)
  assert.equal(pinnedCommit(), newCommit)
  assert.match(readFileSync(join(checkout, "app.txt"), "utf8"), /^<<<<<<< /m)

  // Resolve the conflict the way a person would, then save it.
  writeFileSync(join(checkout, "app.txt"), UPSTREAM_FILE.replace("two", "DEUX"))
  assert.equal(script("export").status, 0)
  const patch = readFileSync(join(repo, "patches", "app.txt.patch"), "utf8")
  assert.match(patch, /^-deux$/m)
  assert.match(patch, /^\+DEUX$/m)
  assert.match(patch, /^Shout line two\.$/m)

  assert.equal(script("setup", "--no-install", "--force").status, 0)
  assert.equal(script("export", "--check").status, 0)
})

test("bump does nothing when the pin is already the tip of the branch", () => {
  const { script, pinnedCommit } = createSandbox()
  const before = pinnedCommit()

  const bump = script("bump")

  assert.equal(bump.status, 0)
  assert.match(bump.stdout, /Already at/)
  assert.equal(pinnedCommit(), before)
})

test("renames.json rewrites upstream text and file names without becoming a patch", () => {
  const sandbox = createSandbox({ "old-name.txt": "made by old-name\n" })
  const { repo, checkout, script, writeRenames } = sandbox
  writeRenames([{ from: "old-name", to: "new-name", why: "Our name." }])

  assert.equal(script("setup", "--no-install").status, 0)

  assert.equal(readFileSync(join(checkout, "new-name.txt"), "utf8"), "made by new-name\n")
  assert.equal(existsSync(join(checkout, "old-name.txt")), false)
  assert.equal(script("export").status, 0)
  assert.equal(existsSync(join(repo, "patches", "new-name.txt.patch")), false)
  assert.equal(existsSync(join(repo, "overlay", "new-name.txt")), false)
})

test("a patch to a renamed file holds only our own edit", () => {
  const sandbox = createSandbox()
  const { repo, checkout, script, writeRenames } = sandbox
  writeRenames([{ pattern: "\\bthree\\b", to: "trois", why: "A rule with a boundary check." }])
  assert.equal(script("setup", "--no-install").status, 0)

  const renamed = UPSTREAM_FILE.replace("three", "trois")
  assert.equal(readFileSync(join(checkout, "app.txt"), "utf8"), renamed)
  writeFileSync(join(checkout, "app.txt"), renamed.replace("two", "TWO"))
  assert.equal(script("export").status, 0)

  const patch = readFileSync(join(repo, "patches", "app.txt.patch"), "utf8")
  assert.match(patch, /^\+TWO$/m)
  assert.doesNotMatch(patch, /^[-+]t(hree|rois)$/m)
  assert.equal(script("setup", "--no-install", "--force").status, 0)
  assert.equal(readFileSync(join(checkout, "app.txt"), "utf8"), renamed.replace("two", "TWO"))
})

test("bump applies the renames to text upstream adds later", () => {
  const sandbox = createSandbox()
  const { checkout, script, editUpstream, writeRenames } = sandbox
  writeRenames([{ from: "one", to: "uno", why: "Our name." }])
  assert.equal(script("setup", "--no-install").status, 0)
  const app = join(checkout, "app.txt")
  writeFileSync(app, readFileSync(app, "utf8").replace("two", "TWO"))
  assert.equal(script("export").status, 0)
  editUpstream("eight", "eight\none more")

  const bump = script("bump")

  assert.equal(bump.status, 0, bump.stderr)
  const merged = readFileSync(join(checkout, "app.txt"), "utf8")
  assert.match(merged, /^uno$/m)
  assert.match(merged, /^uno more$/m)
  assert.match(merged, /^TWO$/m)
})

test("setup stops when a rename rule no longer matches anything upstream", () => {
  const { script, writeRenames } = createSandbox()
  writeRenames([{ from: "a name upstream dropped", to: "ours", why: "Our name." }])

  const setup = script("setup", "--no-install")

  assert.equal(setup.status, 1)
  assert.match(setup.stderr, /no longer match[\s\S]*a name upstream dropped/)
})

test("an upstream binary file we replace is saved whole in overlay/", () => {
  const upstreamIcon = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])
  const ourIcon = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9, 9])
  const sandbox = createSandbox({ "icon.png": upstreamIcon })
  const { repo, checkout, script } = sandbox
  assert.equal(script("setup", "--no-install").status, 0)

  writeFileSync(join(checkout, "icon.png"), ourIcon)
  assert.equal(script("export").status, 0)

  assert.deepEqual(readFileSync(join(repo, "overlay", "icon.png")), ourIcon)
  assert.equal(existsSync(join(repo, "patches", "icon.png.patch")), false)
  assert.equal(script("setup", "--no-install", "--force").status, 0)
  assert.deepEqual(readFileSync(join(checkout, "icon.png")), ourIcon)
  assert.equal(script("export", "--check").status, 0)
})
