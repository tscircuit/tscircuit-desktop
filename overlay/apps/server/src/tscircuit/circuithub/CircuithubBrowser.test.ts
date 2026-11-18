import { describe, it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import { AuthSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as CircuithubBrowser from "./CircuithubBrowser.ts";

const sessionId = Schema.decodeUnknownSync(AuthSessionId);
const token = `header.${Buffer.from(JSON.stringify({ exp: 40_000_000_000, name: "Browser tester" })).toString("base64url")}.signature`;

describe("browser CircuitHub accounts", () => {
  it.effect(
    "uses the CLI authorization endpoint, accepts its callback and isolates authenticated sessions",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* CircuithubBrowser.CircuithubBrowser;
          const owner = sessionId("browser-owner");
          const other = sessionId("browser-other");
          const pending = yield* service.request(owner, { action: "login" });
          expect(pending.account.loginPending).toBe(true);
          const auth = new URL(pending.authorizationUrl!);
          expect(auth.origin + auth.pathname).toBe(
            "https://app.circuithub.com/platform/v1/auth/cli",
          );
          const callback = new URL(auth.searchParams.get("redirect_uri")!);
          callback.searchParams.set("token", token);
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
            displayName: "Browser tester",
          });
          expect(connected.authorizationUrl).toBeNull();
          expect(JSON.stringify(connected)).not.toContain(token);
          yield* service.request(owner, { action: "logout" });
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
