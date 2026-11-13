import { existsSync } from "node:fs"
import { join } from "node:path"
import { run, tryRun } from "./exec.ts"
import { BASE_TAG, checkoutDir } from "./paths.ts"

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
  /** Upstream binary files we replaced, such as icons. They belong in overlay/ too. */
  replaced: string[]
  /** Upstream text files we changed or deleted. Each gets a patch. */
  patched: string[]
}

/**
 * Everything in the checkout that differs from the renamed upstream commit,
 * whether or not it has been committed there.
 */
export function readCheckoutChanges(): CheckoutChanges {
  // Staging makes brand-new files visible to `git diff`. It respects upstream's
  // .gitignore, so node_modules and build output stay out.
  git("add", "--all")
  const diff = (...args: string[]) =>
    lines(git("diff", "--cached", "--no-renames", "-z", ...args, BASE_TAG).replaceAll("\0", "\n"))
  const names = (filter: string) => diff("--name-only", `--diff-filter=${filter}`).sort()
  // numstat prints "-\t-\t<path>" for a file git cannot diff as text.
  const replaced = diff("--numstat", "--diff-filter=M")
    .filter((line) => line.startsWith("-\t-\t"))
    .map((line) => line.slice(4))
    .sort()
  return {
    added: names("A"),
    replaced,
    patched: names("MD").filter((path) => !replaced.includes(path)),
  }
}

/** The diff of one upstream file against the base, in a form `git apply --3way` can merge. */
export const diffAgainstBase = (path: string): string =>
  git("diff", "--cached", "--no-renames", "--full-index", BASE_TAG, "--", path)
