/**
 * Naming and layout of the files in patches/.
 *
 * Each patch covers one upstream file and is named after it, so a failed patch
 * says which file needs attention. The text above the diff is a note for
 * people: why tscircuit desktop changes this file. `git apply` ignores it, and
 * `export` keeps it when it rewrites the diff underneath.
 */

export const NOTE_PLACEHOLDER = "TODO: say why tscircuit desktop changes this file."

const DIFF_START = /^diff --git /m

/** `apps/web/src/a.ts` → `apps__web__src__a.ts.patch` */
export const patchFileName = (upstreamPath: string): string =>
  `${upstreamPath.replaceAll("/", "__")}.patch`

/** Inverse of `patchFileName`. */
export const upstreamPathOf = (fileName: string): string =>
  fileName.replace(/\.patch$/, "").replaceAll("__", "/")

/** The human note above the diff, without surrounding blank lines. */
export function readNote(patchText: string): string {
  const start = patchText.search(DIFF_START)
  return (start === -1 ? patchText : patchText.slice(0, start)).trim()
}

export function composePatch(note: string, diff: string): string {
  return `${note.trim() || NOTE_PLACEHOLDER}\n\n${diff.trimEnd()}\n`
}

export const hasPlaceholderNote = (patchText: string): boolean =>
  readNote(patchText).includes(NOTE_PLACEHOLDER)
