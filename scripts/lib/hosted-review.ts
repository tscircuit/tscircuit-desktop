import { createHash, timingSafeEqual } from "node:crypto"
import { createReadStream } from "node:fs"
import { createServer } from "node:http"
import type { IncomingMessage } from "node:http"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { createProxyServer } from "../../.cache/preview-tools/node_modules/httpxy/dist/index.mjs"
import { checkoutDir } from "./paths.ts"

const viewerFramePath = "/tscircuit-viewer/frame.html"
const viewerFrame = join(checkoutDir, "apps", "web", "dist", viewerFramePath)
export const sandboxPort = 8080
export const sandboxHealthPath = "/_review-ready"
export const sandboxAccessHeader = "x-tscircuit-review-backend"

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

function authorizeSandboxRequest(request: IncomingMessage, privateKey: Buffer) {
  const supplied = request.headers[sandboxAccessHeader]
  if (typeof supplied !== "string" || !/^[0-9a-f]{64}$/.test(supplied)) return false
  delete request.headers[sandboxAccessHeader]
  return timingSafeEqual(privateKey, Buffer.from(supplied, "hex"))
}

function attachPreviewSession(request: IncomingMessage, sessionCookie: string) {
  request.headers.cookie = [sessionCookie, request.headers.cookie].filter(Boolean).join("; ")
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
  const accessKey = process.env.REVIEW_SANDBOX_KEY
  if (!accessKey?.match(/^[0-9a-f]{64}$/)) {
    throw new Error("A private gateway key is required for the sandbox.")
  }
  const privateKey = Buffer.from(accessKey, "hex")
  const proxy = createProxyServer({ target })
  // Authenticate with the app without sharing its credentials with the browser.
  const sessionId = createHash("sha256").update(reviewToken).digest("hex")
  const sessionCookie = `t3_dev_session_${sessionId}=${reviewToken}`
  const gateway = createServer((request, response) => {
    if (!authorizeSandboxRequest(request, privateKey)) {
      response.writeHead(401, { "Cache-Control": "no-store" }).end()
      return
    }
    void ready.then(async () => {
      if (request.method === "GET" && request.url === sandboxHealthPath) {
        response.writeHead(204).end()
        return
      }
      if (request.method === "GET" && request.url?.split("?")[0] === viewerFramePath) {
        const compressed = request.headers["accept-encoding"]?.split(",").some((encoding) => encoding.trim() === "gzip")
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, max-age=600",
          Vary: "Accept-Encoding",
          ...(compressed ? { "Content-Encoding": "gzip" } : {}),
        })
        await pipeline(createReadStream(compressed ? `${viewerFrame}.gz` : viewerFrame), response)
        return
      }
      attachPreviewSession(request, sessionCookie)
      await proxy.web(request, response)
    }).catch(() => {
      if (!response.headersSent) response.writeHead(503, { "Cache-Control": "no-store" })
      response.end("The preview is restarting. Reload this page to reconnect.")
    })
  })
  gateway.on("upgrade", (request, socket, head) => {
    if (!authorizeSandboxRequest(request, privateKey)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")
      return
    }
    void ready.then(() => {
      attachPreviewSession(request, sessionCookie)
      return proxy.ws(request, socket, undefined, head)
    }).catch(() => socket.destroy())
  })
  gateway.listen(Number(process.env.PORT ?? sandboxPort), "0.0.0.0")
  return gateway
}
