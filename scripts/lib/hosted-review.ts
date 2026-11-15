import { createHash } from "node:crypto"
import { createServer } from "node:http"
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
  pairingUrl,
  reviewToken,
}: {
  target: string
  pairingUrl: Promise<string>
  reviewToken: string
}) {
  const proxy = createProxyServer({ target })
  // The app uses a different cookie name when the preview instance restarts.
  const sessionCookie = `t3_dev_session_${createHash("sha256").update(reviewToken).digest("hex")}`
  const gateway = createServer((request, response) => {
    void pairingUrl.then(async (url) => {
      const isSignedIn = request.headers.cookie?.split("; ").some((cookie) => cookie.startsWith(`${sessionCookie}=`))
      if (request.method === "GET" && request.url === "/" && !isSignedIn) {
        const pair = new URL(url)
        response.writeHead(302, { Location: pair.pathname + pair.search + pair.hash, "Cache-Control": "no-store" })
        response.end()
        return
      }
      await proxy.web(request, response)
    }).catch(() => {
      if (!response.headersSent) response.writeHead(503, { "Cache-Control": "no-store" })
      response.end("The preview is restarting. Reload this page to reconnect.")
    })
  })
  gateway.on("upgrade", (request, socket, head) => {
    void pairingUrl.then(() => proxy.ws(request, socket, head)).catch(() => socket.destroy())
  })
  gateway.listen(Number(process.env.PORT ?? 80), "0.0.0.0")
  return gateway
}
