/**
 * Find-and-replace rules from renames.json, applied to upstream before the
 * overlay and patches.
 *
 * A name that upstream writes in a thousand places, such as its product name,
 * cannot be carried as patches: every upstream edit near one would conflict.
 * A rule is re-run from scratch on each new upstream commit instead, so it
 * never conflicts and also covers places upstream adds later.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fail } from "./exec.ts"

interface RuleConfig {
  /** Exact text to replace. Also applied to file paths. */
  from?: string
  /** A regular expression to replace instead, for names that need a boundary check. */
  pattern?: string
  to: string
  /** Why this rename exists. For people; required so the file explains itself. */
  why: string
}

interface RenamesConfig {
  /** Folders of the checkout the rules apply to. */
  paths: string[]
  rules: RuleConfig[]
}

interface Rule {
  /** How error messages name the rule. */
  label: string
  apply: (text: string) => string
  /** Only exact-text rules rename files. */
  renamesPaths: boolean
}

export interface Renames {
  paths: string[]
  rules: Rule[]
}

export function readRenames(file: string): Renames | null {
  if (!existsSync(file)) return null
  const config = JSON.parse(readFileSync(file, "utf8")) as RenamesConfig
  const rules = config.rules.map((rule): Rule => {
    if (!rule.why?.trim()) fail(`A rule in ${file} is missing its "why": ${JSON.stringify(rule)}`)
    if (rule.from !== undefined && rule.pattern === undefined) {
      const { from, to } = rule
      return { label: from, apply: (text) => text.replaceAll(from, to), renamesPaths: true }
    }
    if (rule.pattern !== undefined && rule.from === undefined) {
      const pattern = new RegExp(rule.pattern, "g")
      return {
        label: rule.pattern,
        apply: (text) => text.replace(pattern, rule.to),
        renamesPaths: false,
      }
    }
    return fail(`A rule in ${file} needs exactly one of "from" or "pattern": ${JSON.stringify(rule)}`)
  })
  return { paths: config.paths, rules }
}

/** Text files only: a file with a NUL byte near its start is left alone. */
const looksBinary = (content: Buffer) => content.subarray(0, 8000).includes(0)

export interface RenameResult {
  /** How many files were rewritten or moved. */
  touched: number
  /**
   * Rules that matched nothing. Upstream has probably reworded what the rule
   * was written for, so the rename it stood for is no longer happening.
   */
  unmatched: string[]
}

/**
 * Rewrites the given tracked files in place and moves the ones whose path
 * contains a renamed name.
 */
export function applyRenames(root: string, trackedFiles: string[], renames: Renames): RenameResult {
  const matched = new Set<Rule>()
  const run = (value: string, rules: Rule[]) =>
    rules.reduce((current, rule) => {
      const next = rule.apply(current)
      if (next !== current) matched.add(rule)
      return next
    }, value)
  const pathRules = renames.rules.filter((rule) => rule.renamesPaths)

  let touched = 0
  for (const path of trackedFiles) {
    const absolute = join(root, path)
    if (!lstatSync(absolute).isFile()) continue

    const content = readFileSync(absolute)
    const before = looksBinary(content) ? null : content.toString("utf8")
    const after = before === null ? null : run(before, renames.rules)
    if (after !== null && after !== before) writeFileSync(absolute, after)

    const newPath = run(path, pathRules)
    if (newPath !== path) {
      mkdirSync(dirname(join(root, newPath)), { recursive: true })
      renameSync(absolute, join(root, newPath))
    }
    if (after !== before || newPath !== path) touched += 1
  }
  return {
    touched,
    unmatched: renames.rules.filter((rule) => !matched.has(rule)).map((rule) => rule.label),
  }
}
