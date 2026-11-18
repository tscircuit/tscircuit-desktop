import {
  AuthProvidersManageScope,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { failEnvironmentInternal, requireEnvironmentScope } from "../../auth/http.ts";
import * as CircuithubBrowser from "./CircuithubBrowser.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "circuithub",
  Effect.fnUntraced(function* (handlers) {
    const service = yield* CircuithubBrowser.CircuithubBrowser;
    return handlers.handle(
      "request",
      Effect.fn("circuithub.http.request")(function* (args) {
        yield* requireEnvironmentScope(AuthProvidersManageScope);
        const principal = yield* EnvironmentAuthenticatedPrincipal;
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(
            HttpServerResponse.setHeaders(response, {
              "cache-control": "no-store",
              pragma: "no-cache",
            }),
          ),
        );
        return yield* service
          .request(principal.sessionId, args.payload)
          .pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)));
      }),
    );
  }),
);
