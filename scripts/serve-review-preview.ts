import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import type { IncomingMessage } from "node:http"
import { APIError } from "../.cache/preview-tools/node_modules/@vercel/sandbox/dist/index.js"
import { createProxyServer } from "../.cache/preview-tools/node_modules/httpxy/dist/index.mjs"
import { getHostedOrigins } from "./lib/hosted-review.ts"
import { prepareReviewRequest } from "./lib/review-workspaces.ts"

const commit = process.env.VERCEL_GIT_COMMIT_SHA
if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error("The review gateway requires a Git-backed Vercel preview.")
}

type PreviewHost = string
const origins = new Map<PreviewHost, string>(getHostedOrigins().map((origin) => [new URL(origin).host, origin]))
const revision = commit.slice(0, 12)
const cookieName = "__Host-tscircuit-review"
const proxy = createProxyServer()

function identifyReviewer(request: IncomingMessage) {
  return request.headers.cookie?.split(/;\s*/)
    .find((cookie) => cookie.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1)
    .match(/^[0-9a-f]{64}$/)?.[0]
}

const gateway = createServer((request, response) => {
  const origin = origins.get(request.headers.host ?? "")
  if (!origin) {
    response.writeHead(421).end()
    return
  }

  const reviewer = identifyReviewer(request)
  if (!reviewer) {
    if (request.method === "GET" && request.url === "/") {
      const cookie = `${cookieName}=${randomBytes(32).toString("hex")}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`
      response.writeHead(303, { Location: "/", "Set-Cookie": cookie, "Cache-Control": "no-store" }).end()
    } else {
      response.writeHead(401, { "Cache-Control": "no-store" }).end("Open the preview link to start a workspace.")
    }
    return
  }

  void prepareReviewRequest({ request, origin, reviewer, revision })
    .then((options) => proxy.web(request, response, options))
    .catch((error: unknown) => {
      const reason = error instanceof APIError
        ? `Sandbox API HTTP ${error.response.status}`
        : error instanceof Error && error.message === "The request has no Vercel OIDC token."
          ? error.message
          : "workspace unavailable"
      console.error(`Review preview: ${reason}`)
      if (!response.headersSent) response.writeHead(503, { "Cache-Control": "no-store", "Retry-After": "5" })
      response.end("The review workspace is unavailable. Reload to reconnect.")
    })
})

gateway.on("upgrade", (request, socket, head) => {
  const origin = origins.get(request.headers.host ?? "")
  const reviewer = identifyReviewer(request)
  if (!origin || !reviewer) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")
    return
  }
  void prepareReviewRequest({ request, origin, reviewer, revision })
    .then((options) => proxy.ws(request, socket, options, head))
    .catch(() => socket.destroy())
})

gateway.listen(Number(process.env.PORT ?? 80), "0.0.0.0")
