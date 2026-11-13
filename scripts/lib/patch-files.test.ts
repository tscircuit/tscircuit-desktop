import assert from "node:assert/strict"
import { test } from "node:test"
import {
  composePatch,
  hasPlaceholderNote,
  patchFileName,
  readNote,
  upstreamPathOf,
} from "./patch-files.ts"

const DIFF = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b"

test("a patch is named after the upstream file it changes", () => {
  const path = "packages/contracts/src/settings.ts"
  assert.equal(patchFileName(path), "packages__contracts__src__settings.ts.patch")
  assert.equal(upstreamPathOf(patchFileName(path)), path)
})

test("the note above the diff is kept apart from the diff", () => {
  const patch = composePatch("Why this exists.\nSecond line.", DIFF)
  assert.equal(readNote(patch), "Why this exists.\nSecond line.")
  assert.ok(patch.endsWith("+b\n"))
  assert.equal(hasPlaceholderNote(patch), false)
})

test("a new patch gets a placeholder note that asks to be replaced", () => {
  assert.equal(hasPlaceholderNote(composePatch("", DIFF)), true)
})
