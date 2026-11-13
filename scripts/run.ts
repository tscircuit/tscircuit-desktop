/**
 * Runs a command inside the .t3code/ checkout, with its local tools (such as
 * T3 Code's `vp` task runner) on the PATH.
 *
 * Usage: node scripts/run.ts [--dir <path inside the checkout>] <command> [args...]
 *   e.g. node scripts/run.ts vp run dev:desktop
 *        node scripts/run.ts --dir packages/contracts vp test run src/tscircuit
 */
import { spawn } from "node:child_process"
import { delimiter, join } from "node:path"
import { checkoutExists } from "./lib/checkout.ts"
import { fail } from "./lib/exec.ts"
import { checkoutDir } from "./lib/paths.ts"

const argv = process.argv.slice(2)
const subdirectory = argv[0] === "--dir" ? argv.splice(0, 2)[1] : undefined
const [command, ...args] = argv
if (!command) fail("Usage: node scripts/run.ts [--dir <path>] <command> [args...]")
if (!checkoutExists()) fail("There is no checkout yet. Run `npm run setup` first.")

const child = spawn(command, args, {
  cwd: subdirectory ? join(checkoutDir, subdirectory) : checkoutDir,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    PATH: [join(checkoutDir, "node_modules", ".bin"), process.env.PATH].join(delimiter),
  },
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal))
}
child.on("error", (error) => fail(`Could not start \`${command}\`: ${error.message}`))
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
