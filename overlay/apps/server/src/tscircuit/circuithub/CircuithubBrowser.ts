import type {
  AuthSessionId,
  CircuithubBrowserRequest,
  CircuithubBrowserResponse,
} from "@t3tools/contracts";
import { createCircuithubService } from "@t3tools/shared/circuithub/service";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

export class CircuithubBrowserError extends Schema.TaggedError<CircuithubBrowserError>()(
  "CircuithubBrowserError",
  { cause: Schema.Defect() },
) {}

export class CircuithubBrowser extends Context.Service<
  CircuithubBrowser,
  {
    readonly request: (
      sessionId: AuthSessionId,
      request: CircuithubBrowserRequest,
    ) => Effect.Effect<CircuithubBrowserResponse, CircuithubBrowserError>;
  }
>()("t3/tscircuit/circuithub/CircuithubBrowser") {}

const make = Effect.gen(function* () {
  // Each authenticated browser session owns its account, callback and active upload.
  // Hosted review workspaces are additionally isolated in one sandbox per browser.
  const sessions = new Map<AuthSessionId, ReturnType<typeof createCircuithubService>>();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const session of sessions.values()) session.close();
      sessions.clear();
    }),
  );
  const request = Effect.fn("CircuithubBrowser.request")(
    (sessionId: AuthSessionId, input: CircuithubBrowserRequest) =>
      Effect.tryPromise({
        try: async () => {
          let session = sessions.get(sessionId);
          if (!session) {
            session = createCircuithubService({
              readSession: async () => null,
              writeSession: async () => false,
              clearSession: async () => {},
              // The HTTP response provides an authorization link; the server never opens a browser.
              openBrowser: async () => true,
            });
            sessions.set(sessionId, session);
          }
          const response = await session.request(
            input.action === "complete_login"
              ? { action: "complete_login", callbackUrl: Redacted.value(input.callbackUrl) }
              : input,
          );
          const authorizationUrl = session.authorizationUrl;
          if (input.action === "logout" && response.ok) {
            session.close();
            sessions.delete(sessionId);
          }
          return { ...response, authorizationUrl };
        },
        catch: (cause) => new CircuithubBrowserError({ cause }),
      }),
  );
  return CircuithubBrowser.of({ request });
});

export const layer = Layer.effect(CircuithubBrowser, make);
