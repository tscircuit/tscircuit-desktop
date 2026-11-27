import { expect, it } from "vite-plus/test";
import { createOAuthAccount, tokenPair, type Credentials } from "./oauth.ts";
const initial: Credentials = {
  version: 1,
  clientId: "desktop-test",
  tokenEndpoint: "https://app.circuithub.com/oauth/token",
  revocationEndpoint: "https://app.circuithub.com/oauth/revoke",
  resource: "https://api.circuithub.com",
  accessToken: "cha_old_access",
  refreshToken: "chr_old_refresh",
  expiresAt: 1000,
  renewAt: 500,
  scope: "read design issues",
};
const rotated = {
  access_token: "cha_new_access",
  refresh_token: "chr_new_refresh",
  expires_in: 3600,
  token_type: "Bearer",
};
function setup(fetchFn: typeof fetch, value = JSON.stringify(initial)) {
  let saved: string | null = value;
  const writes: string[] = [];
  const manager = createOAuthAccount({
    read: async () => saved,
    write: async (value) => {
      writes.push(value);
      saved = value;
      return true;
    },
    clear: async () => {
      saved = null;
    },
    fetch: fetchFn,
    now: () => 1000,
  });
  return { manager, writes, saved: () => saved };
}

it("serializes concurrent expiry/401 renewals, saves the rotation first and reuses the new pair", async () => {
  const forms: URLSearchParams[] = [];
  const { manager, saved, writes } = setup(async (_url, init) => {
    forms.push(new URLSearchParams(String(init?.body)));
    return Response.json(rotated);
  });
  const access = await Promise.all(
    Array.from({ length: 5 }, () => manager.accessToken({ rejected: initial.accessToken })),
  );
  expect(access).toEqual(Array(5).fill(rotated.access_token));
  expect(forms).toHaveLength(1);
  expect(forms[0]?.get("refresh_token")).toBe(initial.refreshToken);
  expect(writes).toHaveLength(1);
  expect(JSON.parse(saved()!)).toMatchObject({
    accessToken: rotated.access_token,
    refreshToken: rotated.refresh_token,
    scope: initial.scope,
  });
  expect(manager.persistent).toBe(true);
});

it.each(["invalid_grant", "invalid_client"])("clears a grant refused with %s", async (error) => {
  const { manager, saved } = setup(async () => Response.json({ error }, { status: 400 }));
  await expect(manager.accessToken()).rejects.toThrow("Sign in again");
  expect(saved()).toBeNull();
  expect(manager.current).toBeNull();
});

it.each([429, 503])(
  "keeps the sign-in on a temporary %s failure without leaking response secrets",
  async (status) => {
    const { manager, saved } = setup(async () =>
      Response.json({ error: initial.refreshToken }, { status }),
    );
    const failure = await manager.accessToken().catch((error: unknown) => String(error));
    expect(failure).toContain(`HTTP ${status}`);
    expect(failure).not.toContain(initial.refreshToken);
    expect(JSON.parse(saved()!).refreshToken).toBe(initial.refreshToken);
  },
);

it.each(["network", "truncated"])(
  "retries a lost %s refresh response once within the provider reuse window",
  async (failure) => {
    let attempts = 0;
    const { manager } = setup(async () => {
      attempts++;
      if (attempts === 1) {
        if (failure === "network") throw new Error("connection lost");
        return new Response('{"access_token":', { status: 200 });
      }
      return Response.json(rotated);
    });
    expect(await manager.accessToken()).toBe(rotated.access_token);
    expect(attempts).toBe(2);
  },
);

it("never uses a rotation before saving it; retries the pending save without redeeming again", async () => {
  let failSave = true;
  let refreshes = 0;
  const manager = createOAuthAccount({
    read: async () => JSON.stringify(initial),
    write: async () => {
      if (failSave) throw new Error("disk full");
      return true;
    },
    clear: async () => {},
    fetch: async () => {
      refreshes++;
      return Response.json(rotated);
    },
    now: () => 1000,
  });
  await expect(manager.accessToken()).rejects.toThrow("Could not save");
  expect(manager.persistent).toBe(false);
  failSave = false;
  expect(await manager.accessToken()).toBe(rotated.access_token);
  expect(refreshes).toBe(1);
});

it("revokes the newest refresh token when disconnect races with renewal", async () => {
  const started = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<Response>();
  let revoked: string | null = null;
  const { manager, saved } = setup(async (url, init) => {
    if (String(url).endsWith("/token")) {
      started.resolve();
      return answer.promise;
    }
    revoked = new URLSearchParams(String(init?.body)).get("token");
    return new Response(null, { status: 200 });
  });
  const access = manager.accessToken();
  await started.promise;
  const disconnect = manager.disconnect();
  answer.resolve(Response.json(rotated));
  await Promise.all([access, disconnect]);
  expect(revoked).toBe(rotated.refresh_token);
  expect(saved()).toBeNull();
});

it("keeps a failed revocation available for retry and removes old JWT credentials", async () => {
  const failed = setup(async () => new Response(null, { status: 503 }));
  await expect(failed.manager.disconnect()).rejects.toThrow("Disconnect again");
  expect(failed.saved()).not.toBeNull();
  const legacy = setup(async () => {
    throw new Error("No provider calls expected");
  }, "header.old-jwt.signature");
  await legacy.manager.load();
  expect(legacy.manager.current).toBeNull();
  expect(legacy.saved()).toBeNull();
});

it.each([
  { seconds: 3600, renewAt: 3_301_000 },
  { seconds: 60, renewAt: 31_000 },
])("renews a $seconds second token without a short-token refresh loop", ({ seconds, renewAt }) => {
  expect(tokenPair({ ...rotated, expires_in: seconds }, 1000, initial).renewAt).toBe(renewAt);
});
