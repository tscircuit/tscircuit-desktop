import { describe, it } from "@effect/vitest";
import { expect, vi } from "vite-plus/test";
import { AuthSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as CircuithubBrowser from "./CircuithubBrowser.ts";

const sessionId = Schema.decodeUnknownSync(AuthSessionId);
const issuer = "https://app.circuithub.com";
describe("browser CircuitHub accounts", () => {
  it.effect(
    "isolates OAuth callbacks, keeps tokens off the wire and retains a failed disconnect for retry",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let revokeFails = true;
          using _fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
            if (String(url).endsWith("oauth-authorization-server"))
              return Response.json({
                issuer,
                authorization_endpoint: `${issuer}/oauth/authorize`,
                registration_endpoint: `${issuer}/oauth/register`,
                token_endpoint: `${issuer}/oauth/token`,
                revocation_endpoint: `${issuer}/oauth/revoke`,
              });
            if (String(url).endsWith("/register"))
              return Response.json({ client_id: "browser-test" });
            if (String(url).endsWith("/token"))
              return Response.json({
                access_token: "cha_browser_secret",
                refresh_token: "chr_browser_secret",
                expires_in: 3600,
                scope: "read design issues",
              });
            if (String(url).endsWith("/revoke"))
              return new Response(null, { status: revokeFails ? 503 : 200 });
            throw new Error("Unexpected OAuth request");
          });
          const service = yield* CircuithubBrowser.CircuithubBrowser;
          const owner = sessionId("browser-owner");
          const other = sessionId("browser-other");
          const pending = yield* service.request(owner, { action: "login" });
          expect(pending.account.loginPending).toBe(true);
          const auth = new URL(pending.authorizationUrl!);
          expect(auth.origin + auth.pathname).toBe(`${issuer}/oauth/authorize`);
          const callback = new URL(auth.searchParams.get("redirect_uri")!);
          callback.searchParams.set("code", "browser-code");
          callback.searchParams.set("state", auth.searchParams.get("state")!);
          callback.searchParams.set("iss", issuer);
          expect(
            (yield* service.request(other, {
              action: "complete_login",
              callbackUrl: Redacted.make(callback.href),
            })).ok,
          ).toBe(false);
          expect((yield* service.request(other, { action: "status" })).account.connected).toBe(
            false,
          );
          expect(
            (yield* service.request(owner, {
              action: "complete_login",
              callbackUrl: Redacted.make(callback.href),
            })).ok,
          ).toBe(true);
          const connected = yield* service.request(owner, { action: "status" });
          expect(connected.account).toMatchObject({
            connected: true,
            persistent: false,
            scope: "read design issues",
          });
          expect(connected.authorizationUrl).toBeNull();
          expect(JSON.stringify(connected)).not.toContain("cha_browser_secret");
          expect(JSON.stringify(connected)).not.toContain("chr_browser_secret");
          expect((yield* service.request(owner, { action: "logout" })).ok).toBe(false);
          expect((yield* service.request(owner, { action: "status" })).account.connected).toBe(
            true,
          );
          revokeFails = false;
          expect((yield* service.request(owner, { action: "logout" })).ok).toBe(true);
          expect((yield* service.request(owner, { action: "status" })).account.connected).toBe(
            false,
          );
          expect(
            (yield* service.request(owner, {
              action: "complete_login",
              callbackUrl: Redacted.make(callback.href),
            })).ok,
          ).toBe(false);
        }).pipe(Effect.provide(CircuithubBrowser.layer)),
      ),
  );
});
