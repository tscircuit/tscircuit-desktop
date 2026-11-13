import { existsSync } from "node:fs"
import { join } from "node:path"
import { run, tryRun } from "./exec.ts"
import { checkoutDir, PIN_TAG } from "./paths.ts"

/** Commits made by these scripts inside the checkout are never pushed anywhere. */
const IDENTITY = ["-c", "user.name=tscircuit-desktop", "-c", "user.email=noreply@tscircuit.com"]

export const checkoutExists = () => existsSync(join(checkoutDir, ".git"))

export const git = (...args: string[]) => run("git", [...IDENTITY, ...args], { cwd: checkoutDir })

export const tryGit = (...args: string[]) =>
  tryRun("git", [...IDENTITY, ...args], { cwd: checkoutDir })

const lines = (text: string) => text.split("\n").filter(Boolean)

export interface CheckoutChanges {
  /** Files that do not exist upstream. They belong in overlay/. */
  added: string[]
  /** Upstream files we changed or deleted. Each gets a patch. */
  patched: string[]
}

/**
 * Everything in the checkout that differs from the pinned upstream commit,
 * whether or not it has been committed there.
 */
export function readCheckoutChanges(): CheckoutChanges {
  // Staging makes brand-new files visible to `git diff`. It respects upstream's
  // .gitignore, so node_modules and build output stay out.
  git("add", "--all")
  const names = (filter: string) =>
    lines(
      git("diff", "--cached", "--no-renames", "--name-only", `--diff-filter=${filter}`, PIN_TAG),
    ).sort()
  return { added: names("A"), patched: names("MD") }
}

/** The diff of one upstream file against the pin, in a form `git apply --3way` can merge. */
export const diffAgainstPin = (path: string): string =>
  git("diff", "--cached", "--no-renames", "--full-index", PIN_TAG, "--", path)
