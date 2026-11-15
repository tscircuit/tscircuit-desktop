import { execFile, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { once } from "node:events"
import { tmpdir } from "node:os"
import { delimiter, join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { parseArgs, promisify } from "node:util"
import { checkoutDir } from "./lib/paths.ts"

const { values } = parseArgs({
  options: { screenshots: { type: "string" }, hosted: { type: "boolean" } },
})
const screenshots = values.screenshots && resolve(values.screenshots)
// Keep the preview on its own port so it can run beside normal web development.
const portOffset = 100
const port = 5733 + portOffset
const backendPort = 13773 + portOffset
const localOrigin = `http://localhost:${port}`
const hosted = values.hosted ? await import("./lib/hosted-review.ts") : undefined
const hostedOrigins = hosted?.getHostedOrigins()
const origin = hostedOrigins?.[0] ?? localOrigin
const reviewToken = hostedOrigins ? randomBytes(32).toString("hex") : undefined
const projectTitle = "Voltage divider"
const threadTitle = "Circuit review"
const replayModel = { instanceId: "devReplay", model: "showcase" }

const previewDirectory = await mkdtemp(join(tmpdir(), "tscircuit-review-"))
const appHome = join(previewDirectory, "app-home")
const project = join(previewDirectory, projectTitle)
const env: NodeJS.ProcessEnv = {
  ...(hosted ? {} : process.env),
  HOME: previewDirectory,
  USERPROFILE: previewDirectory,
  PATH: [join(checkoutDir, "node_modules", ".bin"), process.env.PATH].join(delimiter),
  TSCIRCUIT_DESKTOP_PORT_OFFSET: String(portOffset),
  TSCIRCUIT_DESKTOP_DEV_ALLOWED_ORIGINS: hostedOrigins?.join(",") ?? origin,
  TSCIRCUIT_DESKTOP_TELEMETRY_ENABLED: "false",
  ...(hosted ? { TSCIRCUIT_DESKTOP_LOG_LEVEL: "Warn" } : {}),
}
if (reviewToken && hostedOrigins) {
  env.TSCIRCUIT_DESKTOP_DEV_AUTH_TOKEN = reviewToken
} else {
  delete env.TSCIRCUIT_DESKTOP_DEV_AUTH_TOKEN
}
const exec = promisify(execFile)
const ready = Promise.withResolvers<string>()
const gateway = hosted && reviewToken
  ? hosted.serveHostedReview({ target: `http://127.0.0.1:${backendPort}`, pairingUrl: ready.promise, reviewToken })
  : undefined

function cli(...args: string[]) {
  return exec(process.execPath, ["apps/server/src/bin.ts", ...args, "--base-dir", appHome], {
    cwd: checkoutDir,
    env,
    timeout: 90_000,
  })
}

try {
  await cp(join(import.meta.dirname, "fixtures", "review-preview"), project, { recursive: true })
  await mkdir(join(appHome, "userdata"), { recursive: true })
  // Match the upstream scenario launcher: even generated titles cannot reach a paid provider.
  const providers = ["codex", "claudeAgent", "cursor", "grok", "muse", "pi", "opencode", "antigravity"]
  await writeFile(
    join(appHome, "userdata", "settings.json"),
    JSON.stringify({
      defaultModelSelection: replayModel,
      providerInstances: Object.fromEntries(
        providers.map((driver) => [
          driver,
          {
            driver,
            enabled: false,
            ...(driver === "codex" ? { config: { binaryPath: "/usr/bin/false" } } : {}),
          },
        ]),
      ),
    }),
  )
  await cli("project", "add", project, "--title", projectTitle)

  const serverArgs = hosted
    ? ["apps/server/src/bin.ts", "--base-dir", appHome, "--host", "127.0.0.1", "--no-browser"]
    : ["scripts/dev-runner.ts", "dev", "--home-dir", appHome, "--no-seed"]
  const server = spawn(process.execPath, [
    ...serverArgs, "--dev-url", origin, "--port", String(backendPort),
    "--no-auto-bootstrap-project-from-cwd",
  ], { cwd: checkoutDir, env, stdio: ["ignore", "pipe", "inherit"] })
  const stopped = once(server, "exit")
  const stop = () => server.kill("SIGTERM")
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  const output = createInterface({ input: server.stdout })
  const pairing = Promise.withResolvers<string>()
  output.on("line", (line) => {
    const url = /pairingUrl:\s*(\S+)/.exec(line)?.[1]
    if (url) pairing.resolve(url)
    else console.log(line)
  })

  try {
    const url = await Promise.race([
      pairing.promise,
      stopped.then(([code]) => { throw new Error(`Preview exited before pairing (code ${code}).`) }),
    ])
    await cli(
      "thread", "start", project, "Show me how Replay works.", "--title", threadTitle,
      "--provider", replayModel.instanceId, "--model", replayModel.model, "--wait",
    )
    ready.resolve(url)

    if (screenshots) {
      await mkdir(screenshots, { recursive: true })
      const { captureReviewPreview } = await import("./capture-review-preview.ts")
      await captureReviewPreview({ url, screenshots, threadTitle })
    } else if (gateway) {
      const [code] = await stopped
      process.exitCode = code ?? 0
    } else {
      console.log(`\nOpen the preview: ${url}\n`)
      const [code] = await stopped
      process.exitCode = code ?? 0
    }
  } finally {
    stop()
    await stopped
    process.off("SIGINT", stop)
    process.off("SIGTERM", stop)
  }
} finally {
  gateway?.close()
  gateway?.closeAllConnections()
  await rm(previewDirectory, { recursive: true, force: true })
}
