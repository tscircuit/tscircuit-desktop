import { createHash, createHmac } from "node:crypto"
import type { IncomingMessage } from "node:http"
import { setTimeout as delay } from "node:timers/promises"
import { APIError, Sandbox } from "../../.cache/preview-tools/node_modules/@vercel/sandbox/dist/index.js"
import { sandboxAccessHeader, sandboxHealthPath, sandboxPort } from "./hosted-review.ts"

type ReviewWorkspaceName = string
const oneDay = 24 * 60 * 60 * 1000
const toolsDirectory = "/app/.cache/preview-tools/node_modules/.bin"
const workspaces = new Map<ReviewWorkspaceName, Promise<string>>()

function sandboxCredentials(request: IncomingMessage) {
  const token = request.headers["x-vercel-oidc-token"] ?? process.env.VERCEL_OIDC_TOKEN
  if (typeof token !== "string") throw new Error("The request has no Vercel OIDC token.")
  const encodedClaims = token.split(".")[1]
  if (!encodedClaims) throw new Error("The Vercel OIDC token has no claims.")
  const { owner_id: teamId, project_id: projectId } = JSON.parse(
    Buffer.from(encodedClaims, "base64url").toString("utf8"),
  )
  if (typeof teamId !== "string" || typeof projectId !== "string") {
    throw new Error("The Vercel OIDC token does not identify a project.")
  }
  if (process.env.VERCEL_PROJECT_ID && process.env.VERCEL_PROJECT_ID !== projectId) {
    throw new Error("The Vercel OIDC token belongs to a different project.")
  }
  return { token, teamId, projectId }
}

async function isReady(target: string, key: string) {
  try {
    const response = await fetch(new URL(sandboxHealthPath, target), {
      headers: { [sandboxAccessHeader]: key },
      redirect: "error",
      signal: AbortSignal.timeout(1500),
    })
    return response.status === 204
  } catch {
    return false
  }
}

async function startWorkspace({
  name,
  revision,
  origin,
  key,
  credentials,
}: {
  name: ReviewWorkspaceName
  revision: string
  origin: string
  key: string
  credentials: ReturnType<typeof sandboxCredentials>
}) {
  const sandbox = await Sandbox.getOrCreate({
    ...credentials,
    name,
    image: `dockerfile:${revision}`,
    ports: [sandboxPort],
    persistent: true,
    resume: true,
    timeout: 30 * 60 * 1000,
    snapshotExpiration: oneDay,
    keepLastSnapshots: { count: 1 },
  }).catch((error) => {
    if (!(error instanceof APIError) || error.response.status !== 409) throw error
    return Sandbox.get({ ...credentials, name, resume: true })
  })
  const target = sandbox.domain(sandboxPort)
  if (await isReady(target, key)) return target

  // Multiple Vercel instances can reach a new or resumed workspace at once.
  // Only one process may open the workspace database and serve the app.
  await sandbox.runCommand({
    cmd: "/usr/bin/flock",
    args: [
      "-n", "/tmp/tscircuit-review.lock",
      `${toolsDirectory}/node`, "scripts/review-preview.ts", "--sandbox",
    ],
    cwd: "/app",
    env: {
      PATH: `${toolsDirectory}:/usr/local/bin:/usr/bin:/bin`,
      TMPDIR: "/tmp",
      PREVIEW_ORIGIN: origin,
      REVIEW_SANDBOX_KEY: key,
    },
    detached: true,
  })

  for (let attempt = 0; attempt < 24; attempt++) {
    if (await isReady(target, key)) return target
    await delay(500)
  }
  throw new Error("The sandbox app did not start.")
}

export async function prepareReviewRequest({
  request,
  origin,
  reviewer,
  revision,
}: {
  request: IncomingMessage
  origin: string
  reviewer: string
  revision: string
}) {
  const name = `review-${createHash("sha256").update(revision).update(reviewer).digest("hex").slice(0, 32)}`
  const key = createHmac("sha256", reviewer).update(revision).digest("hex")
  let workspace = workspaces.get(name)
  if (!workspace) {
    workspace = startWorkspace({ name, revision, origin, key, credentials: sandboxCredentials(request) })
    workspaces.set(name, workspace)
    void workspace.then(
      () => setTimeout(() => workspaces.delete(name), 15_000).unref(),
      () => workspaces.delete(name),
    )
  }

  // The workspace only needs its own key. Vercel's gateway cookies and
  // platform headers stay at the gateway.
  delete request.headers.cookie
  for (const name of Object.keys(request.headers)) {
    if (name.startsWith("x-vercel-") || name.startsWith("x-forwarded-")) delete request.headers[name]
  }
  request.headers[sandboxAccessHeader] = key
  request.headers["x-forwarded-host"] = new URL(origin).host
  request.headers["x-forwarded-proto"] = "https"
  return { target: await workspace, changeOrigin: true }
}
