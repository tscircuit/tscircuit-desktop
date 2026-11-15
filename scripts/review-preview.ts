import { execFile, spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { copyFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { once } from "node:events"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { setTimeout as delay } from "node:timers/promises"
import { parseArgs, promisify } from "node:util"
import { checkoutDir } from "./lib/paths.ts"

const { values } = parseArgs({
  options: {
    screenshots: { type: "string" },
    hosted: { type: "boolean" },
    "seed-hosted": { type: "boolean" },
  },
})
const screenshots = values.screenshots && resolve(values.screenshots)
const seedHosted = values["seed-hosted"]
// Keep the preview on its own port so it can run beside normal web development.
const portOffset = 100
const port = 5733 + portOffset
const backendPort = 13773 + portOffset
const localOrigin = `http://localhost:${port}`
const hosted = values.hosted ? await import("./lib/hosted-review.ts") : undefined
const hostedOrigins = hosted?.getHostedOrigins()
const origin = hostedOrigins?.[0] ?? localOrigin
const reviewToken = hosted || seedHosted ? randomBytes(32).toString("hex") : undefined
const projectTitle = "Voltage divider"
const threadTitle = "Circuit review"
const replayModel = { instanceId: "devReplay", model: "showcase" }

// The snapshot stores the project's absolute path. Build and runtime use the
// same path inside their isolated containers.
const previewDirectory = hosted || seedHosted
  ? join(tmpdir(), "tscircuit-hosted-review")
  : await mkdtemp(join(tmpdir(), "tscircuit-review-"))
if (hosted || seedHosted) await mkdir(previewDirectory)
const appHome = join(previewDirectory, "app-home")
const stateDirectory = join(appHome, "userdata")
const database = join(stateDirectory, "statev2.sqlite")
const snapshot = resolve(import.meta.dirname, "../.cache/preview-state.sqlite")
const project = join(previewDirectory, projectTitle)
const env: NodeJS.ProcessEnv = {
  ...(hosted || seedHosted ? {} : process.env),
  HOME: previewDirectory,
  USERPROFILE: previewDirectory,
  PATH: [join(checkoutDir, "node_modules", ".bin"), process.env.PATH].join(delimiter),
  TSCIRCUIT_DESKTOP_PORT_OFFSET: String(portOffset),
  TSCIRCUIT_DESKTOP_DEV_ALLOWED_ORIGINS: hostedOrigins?.join(",") ?? origin,
  TSCIRCUIT_DESKTOP_TELEMETRY_ENABLED: "false",
  ...(hosted || seedHosted ? { TSCIRCUIT_DESKTOP_LOG_LEVEL: "Warn" } : {}),
}
if (reviewToken) {
  env.TSCIRCUIT_DESKTOP_DEV_AUTH_TOKEN = reviewToken
} else {
  delete env.TSCIRCUIT_DESKTOP_DEV_AUTH_TOKEN
}
const exec = promisify(execFile)
const ready = Promise.withResolvers<void>()
const gateway = hosted && reviewToken
  ? hosted.serveHostedReview({ target: `http://127.0.0.1:${backendPort}`, ready: ready.promise, reviewToken })
  : undefined

function cli(...args: string[]) {
  return exec(process.execPath, ["apps/server/src/bin.ts", ...args, "--base-dir", appHome], {
    cwd: checkoutDir,
    env,
    timeout: 90_000,
  })
}

async function seedThread() {
  for (let attempt = 0; ; attempt++) {
    try {
      await cli(
        "thread", "start", project, "Show me how Replay works.", "--title", threadTitle,
        "--provider", replayModel.instanceId, "--model", replayModel.model, "--wait",
      )
      return
    } catch (error) {
      // The server can announce pairing before the Replay model catalog is ready.
      if (attempt >= 4 || !String(error).includes("is not advertised by provider devReplay")) throw error
      await delay(1000)
    }
  }
}

try {
  await cp(join(import.meta.dirname, "fixtures", "review-preview"), project, { recursive: true })
  await mkdir(stateDirectory, { recursive: true })
  if (hosted) {
    await copyFile(snapshot, database)
    // The browser compares the environment returned over HTTP with its WebSocket.
    const environmentId = createHash("sha256").update(process.env.VERCEL_URL ?? origin).digest("hex")
    await writeFile(join(stateDirectory, "environment-id"), `preview-${environmentId}\n`)
  }
  // Match the upstream scenario launcher: even generated titles cannot reach a paid provider.
  const providers = ["codex", "claudeAgent", "cursor", "grok", "muse", "pi", "opencode", "antigravity"]
  await writeFile(
    join(stateDirectory, "settings.json"),
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
  if (!hosted) await cli("project", "add", project, "--title", projectTitle)

  const serverArgs = hosted || seedHosted
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
    if (!hosted) await seedThread()
    ready.resolve()

    if (seedHosted) {
      stop()
      await stopped
      await mkdir(dirname(snapshot), { recursive: true })
      await copyFile(database, snapshot)
    } else if (screenshots) {
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
