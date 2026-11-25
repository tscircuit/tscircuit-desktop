import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { manifestFor, manifestProblems, readManifest, sha512Of } from "../../../scripts/lib/update-manifest.ts"

const release = () => {
  const dir = mkdtempSync(join(tmpdir(), "update-manifest-"))
  const zip = join(dir, "tscircuit-desktop-0.1.20-arm64.zip")
  writeFileSync(zip, "the signed app")
  const manifest = join(dir, "latest-mac.yml")
  writeFileSync(
    manifest,
    manifestFor({ version: "0.1.20", filePath: zip, releaseDate: new Date(0) }),
  )
  return { dir, zip, manifest }
}

test("the manifest written for a package names it, its size and its hash", () => {
  const { zip, manifest } = release()
  assert.deepEqual(readManifest(manifestFor({ version: "0.1.20", filePath: zip, releaseDate: new Date(0) })), {
    version: "0.1.20",
    files: [{ url: "tscircuit-desktop-0.1.20-arm64.zip", sha512: sha512Of(zip), size: 14 }],
  })
  assert.deepEqual(manifestProblems(manifest, "0.1.20"), [])
})

test("a manifest that does not match the files being published is refused", () => {
  const { dir, zip, manifest } = release()
  assert.match(manifestProblems(manifest, "0.1.21")[0]!, /is for version 0\.1\.20, not 0\.1\.21/)

  // The same size with other contents: what signing after the manifest was written looks like.
  writeFileSync(zip, "THE SIGNED APP")
  assert.match(manifestProblems(manifest, "0.1.20")[0]!, /different SHA-512/)

  writeFileSync(zip, "a longer package")
  assert.match(manifestProblems(manifest, "0.1.20")[0]!, /is 14 bytes, but it is 16/)

  assert.match(manifestProblems(join(dir, "latest.yml"), "0.1.20")[0]!, /latest\.yml is missing/)

  const missing = join(dir, "latest.yml")
  writeFileSync(missing, "version: 0.1.20\nfiles:\n  - url: gone.exe\n    sha512: abc\n    size: 1\n")
  assert.match(manifestProblems(missing, "0.1.20")[0]!, /gone\.exe, which is not being published/)
})

test("the manifest the build writes for Windows is read", () => {
  const built = [
    "version: 0.1.20",
    "files:",
    "  - url: tscircuit-desktop-0.1.20-x64.exe",
    "    sha512: q83vEjRWeJA=",
    "    size: 123456",
    "path: tscircuit-desktop-0.1.20-x64.exe",
    "sha512: q83vEjRWeJA=",
    "releaseDate: '2026-11-14T19:00:00.000Z'",
  ].join("\r\n")
  assert.deepEqual(readManifest(built), {
    version: "0.1.20",
    files: [{ url: "tscircuit-desktop-0.1.20-x64.exe", sha512: "q83vEjRWeJA=", size: 123456 }],
  })
})
