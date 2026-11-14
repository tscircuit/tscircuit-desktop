/**
 * tscircuit desktop: the circuit viewer is served on a host of its own, so the
 * project code it runs is in another origin than the app and cannot use the
 * app's storage or its session with the local server.
 */
const VIEWER_HOST = "viewer";
/** Where the web app's build keeps the viewer's files (apps/web/public/tscircuit-viewer). */
const VIEWER_FOLDER = "/tscircuit-viewer";
const VIEWER_FILES = new Set(["/frame.html", "/runframe.min.js", "/viewer-assets.js"]);

export type ViewerRoute =
  /** Not the viewer's host: the request is the app's. */
  | { readonly kind: "app" }
  /** One of the viewer's files, which the app's host has at `appUrl`. */
  | { readonly kind: "viewer"; readonly appUrl: string }
  | { readonly kind: "not_found" };

export function routeViewerRequest(input: {
  readonly requestUrl: string;
  readonly method: string;
  readonly appHost: string;
}): ViewerRoute {
  if (!URL.canParse(input.requestUrl)) return { kind: "app" };
  const url = new URL(input.requestUrl);
  if (url.host !== VIEWER_HOST) return { kind: "app" };
  // Anything else would fall through to the app's own page, and run it in the viewer's origin.
  if (!VIEWER_FILES.has(url.pathname) || (input.method !== "GET" && input.method !== "HEAD")) {
    return { kind: "not_found" };
  }
  return { kind: "viewer", appUrl: `${url.protocol}//${input.appHost}${VIEWER_FOLDER}${url.pathname}` };
}

/**
 * The viewer evaluates the project's circuit code, which the app's own policy
 * forbids, so its responses carry this policy instead. Only the app may frame it.
 */
export function makeViewerContentSecurityPolicy(scheme: string): string {
  return [
    "default-src 'self' blob: data: https:",
    // Circuits import packages from npm's CDNs and are run with eval, in a blob worker.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https:",
    "connect-src 'self' blob: data: http: https:",
    "img-src 'self' blob: data: http: https:",
    "style-src 'self' 'unsafe-inline' https:",
    "font-src 'self' data: https:",
    "worker-src 'self' blob:",
    "frame-src blob: https:",
    "form-action 'none'",
    `frame-ancestors ${scheme}:`,
  ].join("; ");
}
