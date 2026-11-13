import { spawnSync } from "node:child_process"

export interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
}

interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Print the command's output as it runs. Its stdout is then not captured. */
  inherit?: boolean
}

/** Runs a command and reports failure in the result, without throwing. */
export function tryRun(command: string, args: string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.error) {
    return { ok: false, stdout: "", stderr: result.error.message }
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

/** Runs a command and stops the script with its error output if it fails. */
export function run(command: string, args: string[], options: RunOptions = {}): string {
  const result = tryRun(command, args, options)
  if (!result.ok) {
    fail(`\`${command} ${args.join(" ")}\` failed.\n${result.stderr.trim()}`)
  }
  return result.stdout
}

export function fail(message: string, exitCode = 1): never {
  console.error(`\n${message}\n`)
  process.exit(exitCode)
}

export const step = (message: string) => console.log(`• ${message}`)
