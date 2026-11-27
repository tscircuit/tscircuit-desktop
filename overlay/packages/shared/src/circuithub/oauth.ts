// @effect-diagnostics globalDate:off -- OAuth token lifetimes use provider expiry and a testable clock.
export const ISSUER = "https://app.circuithub.com";
export const RESOURCE = "https://api.circuithub.com";
export const SCOPE = "read design issues";
export interface Credentials {
  version: 1;
  clientId: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  resource: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  renewAt: number;
  scope: string;
}
export function providerEndpoint(value: unknown): string {
  if (typeof value !== "string") throw new Error("CircuitHub returned an invalid OAuth endpoint.");
  const url = new URL(value);
  if (url.origin !== ISSUER || url.username || url.password || url.hash || url.search)
    throw new Error("CircuitHub returned an invalid OAuth endpoint.");
  return url.href;
}
const secret = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 16_384;
function readCredentials(value: string): Credentials | null {
  try {
    const c = JSON.parse(value) as Credentials;
    if (
      c.version !== 1 ||
      c.resource !== RESOURCE ||
      !secret(c.clientId) ||
      !secret(c.accessToken) ||
      !secret(c.refreshToken) ||
      typeof c.scope !== "string" ||
      c.scope.length > 512 ||
      !Number.isFinite(c.expiresAt) ||
      !Number.isFinite(c.renewAt) ||
      c.renewAt > c.expiresAt
    )
      return null;
    providerEndpoint(c.tokenEndpoint);
    providerEndpoint(c.revocationEndpoint);
    return c;
  } catch {
    return null;
  }
}
export function tokenPair(body: unknown, sentAt: number, previous: Pick<Credentials, "scope">) {
  const t = body as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    token_type?: unknown;
    scope?: unknown;
  } | null;
  if (
    !t ||
    !secret(t.access_token) ||
    !secret(t.refresh_token) ||
    typeof t.expires_in !== "number" ||
    !Number.isFinite(t.expires_in) ||
    t.expires_in <= 0 ||
    t.expires_in > 365 * 24 * 3600 ||
    (t.token_type !== undefined && t.token_type !== "Bearer") ||
    (t.scope !== undefined && (typeof t.scope !== "string" || t.scope.length > 512))
  )
    throw new Error("CircuitHub returned an invalid sign-in response. Please try again.");
  const lifetime = t.expires_in * 1000;
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: sentAt + lifetime,
    renewAt: sentAt + Math.max(lifetime - 5 * 60_000, lifetime / 2),
    scope: typeof t.scope === "string" ? t.scope : previous.scope,
  };
}
export async function postForm(fetchFn: typeof fetch, url: string, values: Record<string, string>) {
  const response = await fetchFn(providerEndpoint(url), {
    method: "POST",
    redirect: "error",
    body: new URLSearchParams(values),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}
interface Store {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<boolean>;
  clear: () => Promise<void>;
  fetch: typeof fetch;
  now?: () => number;
}
export function createOAuthAccount(store: Store) {
  let current: Credentials | null = null;
  let persistent = false;
  let pendingSave = false;
  let loaded: Promise<void> | null = null;
  let queue = Promise.resolve();
  const now = store.now ?? Date.now;
  // Electron owns one profile per process; browser sessions each own one instance.
  // Serialize rotation, persistence and revocation so a single-use token is redeemed once.
  const locked = <T>(work: () => Promise<T>) => {
    const result = queue.then(work, work);
    queue = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const load = () =>
    (loaded ??= locked(async () => {
      const saved = await store.read();
      if (!saved) return;
      current = readCredentials(saved);
      persistent = current !== null;
      if (!current) await store.clear();
    }).catch(() => {
      loaded = null;
      throw new Error("Could not unlock the saved CircuitHub sign-in. Please try again.");
    }));
  const save = async (credentials: Credentials) => {
    current = credentials;
    pendingSave = true;
    persistent = false;
    try {
      persistent = await store.write(JSON.stringify(credentials));
      pendingSave = false;
    } catch {
      throw new Error("Could not save the CircuitHub sign-in. Keep the app open and try again.");
    }
  };
  const clear = async () => {
    current = null;
    persistent = false;
    pendingSave = false;
    await store.clear();
  };
  return {
    load,
    get current() {
      return current;
    },
    get persistent() {
      return persistent;
    },
    async connect(credentials: Credentials, isCurrent: () => boolean) {
      await load();
      return locked(async () => {
        if (!isCurrent()) return;
        await save(credentials);
        if (!isCurrent()) await clear();
      });
    },
    async accessToken(options: { rejected?: string } = {}) {
      await load();
      return locked(async () => {
        if (!current) throw new Error("Sign in to CircuitHub to request a quote.");
        if (pendingSave) await save(current);
        if (current.accessToken !== options.rejected && now() < current.renewAt)
          return current.accessToken;
        const previous = current;
        const sentAt = now();
        const refresh = async () => {
          const result = await postForm(store.fetch, previous.tokenEndpoint, {
            grant_type: "refresh_token",
            refresh_token: previous.refreshToken,
            client_id: previous.clientId,
          });
          if (result.ok) tokenPair(result.body, sentAt, previous);
          return result;
        };
        // CircuitHub permits one immediate retry of a lost refresh response within 30 seconds.
        const result = await refresh().catch(refresh);
        const error = (result.body as { error?: unknown } | null)?.error;
        if (
          (result.status === 400 || result.status === 401) &&
          (error === "invalid_grant" || error === "invalid_client")
        ) {
          await clear();
          throw new Error("CircuitHub ended this sign-in. Sign in again.");
        }
        if (!result.ok)
          throw new Error(
            `Could not renew CircuitHub sign-in (HTTP ${result.status}). Please try again.`,
          );
        await save({ ...previous, ...tokenPair(result.body, sentAt, previous) });
        return current!.accessToken;
      });
    },
    async disconnect() {
      await load();
      return locked(async () => {
        if (current) {
          const result = await postForm(store.fetch, current.revocationEndpoint, {
            token: current.refreshToken,
            client_id: current.clientId,
          });
          if (!result.ok)
            throw new Error(
              `Could not disconnect CircuitHub (HTTP ${result.status}). Please try Disconnect again.`,
            );
        }
        await clear();
      });
    },
  };
}
