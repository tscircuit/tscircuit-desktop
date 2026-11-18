// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off -- Native loopback login owns HTTP callbacks, its deadline and synchronous JWT expiry checks outside Effect fibers.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

export function tokenClaims(
  token: string,
  now = Date.now(),
): { name: string | null; expiresAt: number } | null {
  try {
    if (token.length > 16_384 || token.split(".").length !== 3) return null;
    const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now)
      return null;
    return {
      name: typeof claims.name === "string" ? claims.name.slice(0, 200) : null,
      expiresAt: claims.exp * 1000,
    };
  } catch {
    return null;
  }
}

export async function startLogin() {
  const callback = `/circuithub/callback/${NodeCrypto.randomBytes(24).toString("hex")}`;
  let resolveToken!: (token: string) => void;
  let rejectToken!: (error: Error) => void;
  let finished = false;
  const token = new Promise<string>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });
  // A caller may cancel immediately, before attaching its completion handler.
  void token.catch(() => {});
  let port = 0;
  const acceptCallback = (value: string): boolean => {
    if (finished || value.length > 20_000) return false;
    try {
      const url = new URL(value);
      if (
        url.origin !== `http://localhost:${port}` ||
        url.pathname !== callback ||
        url.username ||
        url.password ||
        url.hash
      )
        return false;
      const received = url.searchParams.get("token");
      if (!received || !tokenClaims(received)) return false;
      finished = true;
      resolveToken(received);
      return true;
    } catch {
      return false;
    }
  };
  const server = NodeHttp.createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://localhost:${port}`);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (req.method !== "GET" || url.pathname !== callback || finished) {
      res.writeHead(404).end();
      return;
    }
    const valid = acceptCallback(url.href);
    res.writeHead(valid ? 200 : 400, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(
      `<html><body><h2>${valid ? "Signed in to CircuitHub" : "CircuitHub sign-in failed"}</h2><p>${valid ? "You can close this tab and return to tscircuit desktop." : "Return to tscircuit desktop and try signing in again."}</p></body></html>`,
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Could not start CircuitHub sign-in.");
  port = address.port;
  // Match the CLI's localhost redirect, including browsers that resolve it to IPv6 first.
  const ipv6Server = NodeHttp.createServer(
    server.listeners("request")[0] as NodeHttp.RequestListener,
  );
  ipv6Server.on("error", () => {});
  ipv6Server.listen(port, "::1");
  const redirect = `http://localhost:${port}${callback}`;
  const timer = setTimeout(() => {
    rejectToken(new Error("CircuitHub sign-in timed out. Please try again."));
    close();
  }, 180_000);
  timer.unref();
  function close() {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
    ipv6Server.close();
    ipv6Server.closeAllConnections();
    if (!finished) {
      finished = true;
      rejectToken(new Error("CircuitHub sign-in cancelled."));
    }
  }
  return {
    url: `https://app.circuithub.com/platform/v1/auth/cli?redirect_uri=${redirect}`,
    token,
    acceptCallback,
    close,
  };
}
