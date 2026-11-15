import { createHash } from "node:crypto"
import { createServer } from "node:http"
import type { IncomingMessage } from "node:http"
import { createProxyServer } from "../../.cache/preview-tools/node_modules/httpxy/dist/index.mjs"

export function getHostedOrigins() {
  const { PREVIEW_ORIGIN, VERCEL_BRANCH_URL, VERCEL_URL, VERCEL_ENV } = process.env
  if (VERCEL_ENV && VERCEL_ENV !== "preview") {
    throw new Error("The full review app must run in a Vercel Preview deployment.")
  }
  const origins = [PREVIEW_ORIGIN, VERCEL_BRANCH_URL && `https://${VERCEL_BRANCH_URL}`,
    VERCEL_URL && `https://${VERCEL_URL}`].filter((url): url is string => Boolean(url))
  if (!origins.length) throw new Error("No hosted preview origin configured.")
  return origins.map((url) => new URL(url).origin)
}

export function serveHostedReview({
  target,
  ready,
  reviewToken,
}: {
  target: string
  ready: Promise<void>
  reviewToken: string
}) {
  const proxy = createProxyServer({ target })
  // Vercel Deployment Protection authenticates the reviewer before the request
  // arrives here. Authenticate with the local app so requests can land on any
  // preview instance without sharing its credentials with the browser.
  const sessionId = createHash("sha256").update(reviewToken).digest("hex")
  const sessionCookie = `t3_dev_session_${sessionId}=${reviewToken}`
  const authenticate = (request: IncomingMessage) => {
    request.headers.cookie = [sessionCookie, request.headers.cookie].filter(Boolean).join("; ")
  }
  const gateway = createServer((request, response) => {
    void ready.then(async () => {
      authenticate(request)
      await proxy.web(request, response)
    }).catch(() => {
      if (!response.headersSent) response.writeHead(503, { "Cache-Control": "no-store" })
      response.end("The preview is restarting. Reload this page to reconnect.")
    })
  })
  gateway.on("upgrade", (request, socket, head) => {
    void ready.then(() => {
      authenticate(request)
      return proxy.ws(request, socket, head)
    }).catch(() => socket.destroy())
  })
  gateway.listen(Number(process.env.PORT ?? 80), "0.0.0.0")
  return gateway
}
