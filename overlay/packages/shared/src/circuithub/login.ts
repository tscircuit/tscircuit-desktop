// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off -- Native OAuth owns its loopback listener and authorization deadline.
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import {
  ISSUER,
  RESOURCE,
  SCOPE,
  providerEndpoint,
  postForm,
  tokenPair,
  type Credentials,
} from "./oauth.ts";

export async function startLogin(fetchFn = globalThis.fetch) {
  const discovery = await fetchFn(`${ISSUER}/.well-known/oauth-authorization-server`, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!discovery.ok)
    throw new Error(`Could not discover CircuitHub sign-in (HTTP ${discovery.status}).`);
  const metadata = (await discovery.json()) as {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    revocation_endpoint: string;
  };
  if (metadata.issuer !== ISSUER)
    throw new Error("CircuitHub sign-in returned a different issuer.");
  const authorizationEndpoint = providerEndpoint(metadata.authorization_endpoint);
  const tokenEndpoint = providerEndpoint(metadata.token_endpoint);
  const revocationEndpoint = providerEndpoint(metadata.revocation_endpoint);
  const registration = await fetchFn(providerEndpoint(metadata.registration_endpoint), {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "tscircuit desktop",
      redirect_uris: ["http://127.0.0.1/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!registration.ok)
    throw new Error(`Could not register CircuitHub sign-in (HTTP ${registration.status}).`);
  const { client_id: clientId } = (await registration.json()) as { client_id: unknown };
  if (typeof clientId !== "string" || !clientId || clientId.length > 1024)
    throw new Error("CircuitHub returned an invalid registration.");
  const verifier = NodeCrypto.randomBytes(32).toString("base64url");
  const state = NodeCrypto.randomBytes(24).toString("base64url");
  let resolveAnswer!: (answer: URLSearchParams) => void;
  let rejectAnswer!: (error: Error) => void;
  let finished = false;
  let redirect = "";
  const answered = new Promise<URLSearchParams>((resolve, reject) => {
    resolveAnswer = resolve;
    rejectAnswer = reject;
  });
  void answered.catch(() => {});
  const acceptCallback = (value: string) => {
    if (finished || value.length > 20_000) return false;
    try {
      const url = new URL(value);
      const expected = new URL(redirect);
      if (
        url.origin !== expected.origin ||
        url.pathname !== expected.pathname ||
        url.username ||
        url.password ||
        url.hash ||
        url.searchParams.getAll("state").length !== 1 ||
        url.searchParams.get("state") !== state ||
        url.searchParams.getAll("iss").length !== 1 ||
        url.searchParams.get("iss") !== ISSUER ||
        (url.searchParams.getAll("code").length !== 1 && !url.searchParams.has("error"))
      )
        return false;
      finished = true;
      resolveAnswer(url.searchParams);
      return true;
    } catch {
      return false;
    }
  };
  const server = NodeHttp.createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", redirect);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (req.method !== "GET" || url.pathname !== "/callback" || finished) {
      res.writeHead(404).end();
      return;
    }
    const valid = acceptCallback(url.href);
    res.writeHead(valid ? 200 : 400, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'",
    });
    res.end(
      valid
        ? "Return to tscircuit desktop to finish signing in. You can close this tab."
        : "CircuitHub sign-in failed. Return to tscircuit desktop and try again.",
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start CircuitHub sign-in.");
  }
  redirect = `http://127.0.0.1:${address.port}/callback`;
  const authorize = new URL(authorizationEndpoint);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: NodeCrypto.createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
    resource: RESOURCE,
    scope: SCOPE,
  }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    rejectAnswer(new Error("CircuitHub sign-in timed out. Please try again."));
    close();
  }, 180_000);
  timer.unref();
  function close() {
    clearTimeout(timer);
    controller.abort();
    server.close();
    server.closeAllConnections();
    if (!finished) {
      finished = true;
      rejectAnswer(new Error("CircuitHub sign-in cancelled."));
    }
  }
  const credentials = answered.then(async (answer): Promise<Credentials> => {
    if (answer.has("error")) throw new Error("CircuitHub sign-in was declined. Please try again.");
    const code = answer.get("code");
    if (!code) throw new Error("CircuitHub did not return a sign-in code.");
    controller.signal.throwIfAborted();
    const sentAt = Date.now();
    const result = await postForm(fetchFn, tokenEndpoint, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
      resource: RESOURCE,
    });
    controller.signal.throwIfAborted();
    if (!result.ok)
      throw new Error(
        `Could not redeem CircuitHub sign-in (HTTP ${result.status}). Please try again.`,
      );
    return {
      version: 1,
      clientId,
      tokenEndpoint,
      revocationEndpoint,
      resource: RESOURCE,
      ...tokenPair(result.body, sentAt, { scope: SCOPE }),
    };
  });
  void credentials.catch(() => {});
  return { url: authorize.href, credentials, acceptCallback, close };
}
