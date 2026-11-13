import { join } from "node:path"

export const repoRoot = join(import.meta.dirname, "..", "..")

/** The generated T3 Code checkout. Never committed; rebuilt by `setup`. */
export const checkoutDir = join(repoRoot, ".t3code")

/** New files, laid out exactly as they sit inside the checkout. */
export const overlayDir = join(repoRoot, "overlay")

/** One patch per upstream file that tscircuit desktop changes. */
export const patchesDir = join(repoRoot, "patches")

export const pinFile = join(repoRoot, "upstream.json")

/** Find-and-replace rules applied to upstream before the overlay and patches. */
export const renamesFile = join(repoRoot, "renames.json")

/** Tag inside the checkout marking the pinned upstream commit. */
export const PIN_TAG = "upstream-pin"

/**
 * Tag inside the checkout marking upstream after the renames in renames.json.
 * overlay/ and patches/ are the difference from this point, not from the pin.
 */
export const BASE_TAG = "tscircuit-base"

/** Branch inside the checkout that holds upstream plus our changes. */
export const WORK_BRANCH = "tscircuit"

/** Tag inside the checkout marking the state that is saved in this repo. */
export const SAVED_TAG = "tscircuit-saved"
