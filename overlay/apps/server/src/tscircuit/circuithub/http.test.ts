import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Etag from "effect/http/Etag";
import { expect, it, vi } from "vite-plus/test";
import {
  AuthSessionId,
  AuthProvidersManageScope,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentAuthInvalidError,
  EnvironmentCircuithubHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";
import * as CircuithubBrowser from "./CircuithubBrowser.ts";
import { layer } from "./http.ts";

const id = Schema.decodeSync(AuthSessionId)("browser-test");
it.each(["unauthenticated", "read-only", "provider-manager"] as const)(
  "authorizes CircuitHub requests for %s",
  async (role) => {
    const request = vi.fn(() =>
      Effect.succeed({
        ok: true,
        account: {
          connected: false,
          displayName: null,
          expiresAt: null,
          loginPending: false,
          persistent: false,
          progress: null,
        },
        quote: null,
        error: null,
        authorizationUrl: null,
      }),
    );
    const auth = Layer.succeed(EnvironmentAuthenticatedAuth, (effect) =>
      role === "unauthenticated"
        ? Effect.fail(
            new EnvironmentAuthInvalidError({
              code: "auth_invalid",
              reason: "missing_credential",
              traceId: "test",
            }),
          )
        : effect.pipe(
            Effect.provideService(EnvironmentAuthenticatedPrincipal, {
              sessionId: id,
              subject: "test",
              method: "browser-session-cookie",
              scopes: new Set(role === "provider-manager" ? [AuthProvidersManageScope] : []),
            }),
          ),
    );
    const routes = HttpApiBuilder.layer(
      HttpApi.make("environment").add(EnvironmentCircuithubHttpApi),
    ).pipe(
      Layer.provide(layer),
      Layer.provide(auth),
      Layer.provide(Layer.succeed(CircuithubBrowser.CircuithubBrowser, { request })),
      Layer.provide(NodeHttpPlatform.layer),
      Layer.provide(NodeServices.layer),
      Layer.provide(Etag.layerWeak),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
    try {
      const response = await handler(
        new Request("https://preview.example/api/circuithub", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "login" }),
        }),
      );
      expect(response.status).toBe(
        role === "provider-manager" ? 200 : role === "unauthenticated" ? 401 : 403,
      );
      if (role === "provider-manager") {
        expect(request).toHaveBeenCalledWith(id, { action: "login" });
        expect(response.headers.get("cache-control")).toBe("no-store");
      } else expect(request).not.toHaveBeenCalled();
    } finally {
      await dispose();
    }
  },
);
