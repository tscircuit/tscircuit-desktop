// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- Exercises a real loopback callback with a fake OAuth provider.
import * as NodeCrypto from "node:crypto";
import { expect, it } from "vite-plus/test";
import { startLogin } from "./login.ts";

const issuer = "https://app.circuithub.com";
function provider() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    if (String(url).endsWith("oauth-authorization-server"))
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        registration_endpoint: `${issuer}/oauth/register`,
        token_endpoint: `${issuer}/oauth/token`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
      });
    if (String(url).endsWith("/register")) return Response.json({ client_id: "desktop-test" });
    if (String(url).endsWith("/token"))
      return Response.json({
        access_token: "cha_access",
        refresh_token: "chr_refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "read design issues",
      });
    throw new Error("Unexpected OAuth request");
  };
  return { calls, fetchFn };
}
function answer(session: Awaited<ReturnType<typeof startLogin>>) {
  const authorize = new URL(session.url);
  const callback = new URL(authorize.searchParams.get("redirect_uri")!);
  callback.searchParams.set("code", "authorization-code");
  callback.searchParams.set("state", authorize.searchParams.get("state")!);
  callback.searchParams.set("iss", issuer);
  return callback;
}

it("uses discovered OAuth endpoints, PKCE and the API resource; redeems a code without exposing tokens", async () => {
  const { calls, fetchFn } = provider();
  const session = await startLogin(fetchFn);
  try {
    const authorize = new URL(session.url);
    expect(authorize.origin + authorize.pathname).toBe(`${issuer}/oauth/authorize`);
    expect(authorize.searchParams.get("scope")).toBe("read design issues");
    expect(authorize.searchParams.get("resource")).toBe("https://api.circuithub.com");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(JSON.parse(String(calls[1]!.init?.body))).toMatchObject({
      client_name: "tscircuit desktop",
      redirect_uris: ["http://127.0.0.1/callback"],
      token_endpoint_auth_method: "none",
    });
    const callback = answer(session);
    expect(callback.hostname).toBe("127.0.0.1");
    expect((await fetch(new URL("/wrong", callback))).status).toBe(404);
    expect((await fetch(new URL(callback.pathname, callback))).status).toBe(400);
    const response = await fetch(callback);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain("authorization-code");
    const credentials = await session.credentials;
    expect(credentials).toMatchObject({
      accessToken: "cha_access",
      refreshToken: "chr_refresh",
      resource: "https://api.circuithub.com",
    });
    const form = new URLSearchParams(String(calls[2]!.init?.body));
    expect(form.get("resource")).toBe("https://api.circuithub.com");
    expect(form.get("redirect_uri")).toBe(authorize.searchParams.get("redirect_uri"));
    expect(
      NodeCrypto.createHash("sha256").update(form.get("code_verifier")!).digest("base64url"),
    ).toBe(authorize.searchParams.get("code_challenge"));
    expect((await fetch(callback)).status).toBe(404);
  } finally {
    session.close();
  }
});

it("accepts pasted callbacks only for this origin, state and issuer, once", async () => {
  const { fetchFn } = provider();
  const session = await startLogin(fetchFn);
  try {
    const callback = answer(session);
    for (const [key, value] of [
      ["state", "another-login"],
      ["iss", "https://evil.example"],
    ]) {
      const wrong = new URL(callback);
      wrong.searchParams.set(key!, value!);
      expect(session.acceptCallback(wrong.href)).toBe(false);
    }
    const foreign = new URL(callback);
    foreign.hostname = "example.com";
    expect(session.acceptCallback(foreign.href)).toBe(false);
    expect(session.acceptCallback(callback.href)).toBe(true);
    expect((await session.credentials).accessToken).toBe("cha_access");
    expect(session.acceptCallback(callback.href)).toBe(false);
  } finally {
    session.close();
  }
});

it("cancels an unfinished sign-in", async () => {
  const session = await startLogin(provider().fetchFn);
  session.close();
  await expect(session.credentials).rejects.toThrow("cancelled");
});

it.each(["issuer", "token_endpoint"])(
  "rejects untrusted discovery %s before registration or code redemption",
  async (field) => {
    let requests = 0;
    const fetchFn: typeof fetch = async () => {
      requests++;
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        registration_endpoint: `${issuer}/oauth/register`,
        token_endpoint: `${issuer}/oauth/token`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        [field]: "https://evil.example/oauth/token",
      });
    };
    await expect(startLogin(fetchFn)).rejects.toThrow(/issuer|endpoint/);
    expect(requests).toBe(1);
  },
);
