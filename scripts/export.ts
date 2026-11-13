/**
 * Saves the work in .t3code/ back into this repo:
 *
 *   - files that do not exist upstream are copied to overlay/
 *   - every upstream file we changed gets one patch in patches/
 *
 * Usage: node scripts/export.ts [--check]
 *
 * --check writes nothing. It fails if overlay/ and patches/ are out of date
 * with the checkout, or if a patch still lacks its note. CI runs it.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative } from "node:path"
import { checkoutExists, diffAgainstPin, git, readCheckoutChanges } from "./lib/checkout.ts"
import { fail, step } from "./lib/exec.ts"
import {
  composePatch,
  hasPlaceholderNote,
  patchFileName,
  readNote,
} from "./lib/patch-files.ts"
import { checkoutDir, overlayDir, patchesDir, SAVED_TAG } from "./lib/paths.ts"

const checkOnly = process.argv.includes("--check")

if (!checkoutExists()) fail("There is no checkout yet. Run `npm run setup` first.")

const changes = readCheckoutChanges()

const wantedOverlay = new Map<string, Buffer>(
  changes.added.map((path) => [path, readFileSync(join(checkoutDir, path))]),
)

const wantedPatches = new Map<string, string>(
  changes.patched.map((path) => {
    const fileName = patchFileName(path)
    const existing = join(patchesDir, fileName)
    const note = existsSync(existing) ? readNote(readFileSync(existing, "utf8")) : ""
    return [fileName, composePatch(note, diffAgainstPin(path))]
  }),
)

const stale = [
  ...compare(overlayDir, wantedOverlay, "overlay"),
  ...compare(patchesDir, wantedPatches, "patches"),
]
const missingNotes = [...wantedPatches]
  .filter(([, text]) => hasPlaceholderNote(text))
  .map(([fileName]) => `patches/${fileName}`)

if (checkOnly) {
  if (stale.length > 0) {
    fail(`Out of date with the checkout (run \`npm run export\`):\n${indent(stale)}`)
  }
  if (missingNotes.length > 0) {
    fail(`These patches still need a note saying why they exist:\n${indent(missingNotes)}`)
  }
  console.log(
    `overlay/ (${wantedOverlay.size} files) and patches/ (${wantedPatches.size}) match the checkout.`,
  )
  process.exit(0)
}

sync(overlayDir, wantedOverlay)
sync(patchesDir, wantedPatches)

// Record that the checkout is saved, so `setup` knows it is safe to rebuild.
git("commit", "--quiet", "--allow-empty", "-m", "tscircuit desktop: exported")
git("tag", "--force", SAVED_TAG)

step(`overlay/: ${wantedOverlay.size} files`)
step(`patches/: ${wantedPatches.size} patches`)
if (stale.length === 0) console.log("Nothing changed.")
if (missingNotes.length > 0) {
  console.log(
    `\nAdd a note at the top of each new patch saying why it exists:\n${indent(missingNotes)}`,
  )
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return []
  return (readdirSync(root, { recursive: true }) as string[])
    .map((entry) => join(root, entry))
    .filter((path) => statSync(path).isFile())
    .map((path) => relative(root, path).replaceAll("\\", "/"))
}

/** Names what differs between a directory and the content it should hold. */
function compare(root: string, wanted: Map<string, Buffer | string>, label: string): string[] {
  const differences: string[] = []
  const present = new Set(listFiles(root))
  for (const [path, content] of wanted) {
    if (!present.has(path)) differences.push(`${label}/${path} (missing)`)
    else if (!Buffer.from(content).equals(readFileSync(join(root, path)))) {
      differences.push(`${label}/${path} (changed)`)
    }
  }
  for (const path of present) {
    if (!wanted.has(path)) differences.push(`${label}/${path} (no longer needed)`)
  }
  return differences
}

function sync(root: string, wanted: Map<string, Buffer | string>): void {
  for (const path of listFiles(root)) {
    if (!wanted.has(path)) rmSync(join(root, path))
  }
  for (const [path, content] of wanted) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

function indent(items: string[]): string {
  return items.map((item) => `  ${item}`).join("\n")
}
