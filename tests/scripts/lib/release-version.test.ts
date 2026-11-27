import assert from "node:assert/strict"
import { test } from "node:test"
import { nextVersion } from "../../../scripts/lib/release-version.ts"

test("a release is one patch number above the highest release", () => {
  assert.equal(nextVersion(["v0.1.59", "v0.1.61", "v0.1.57"], "patch"), "0.1.62")
  // By number, not by spelling or by the order the tags are listed in.
  assert.equal(nextVersion(["v0.1.9", "v0.1.10"], "patch"), "0.1.11")
  assert.equal(nextVersion(["v0.2.0", "v0.1.61"], "patch"), "0.2.1")
})

test("the minor number only moves when asked, and starts the patch numbers again", () => {
  assert.equal(nextVersion(["v0.1.61", "v0.1.59"], "minor"), "0.2.0")
  assert.equal(nextVersion(["v0.2.3", "v0.1.61"], "minor"), "0.3.0")
})

test("tags that are not release numbers are not counted", () => {
  assert.equal(nextVersion(["v0.1.61", "v0.1.99-pr.4.7", "nightly", "v9"], "patch"), "0.1.62")
  assert.equal(nextVersion([], "patch"), "0.1.0")
  assert.equal(nextVersion(["nightly"], "minor"), "0.1.0")
})
