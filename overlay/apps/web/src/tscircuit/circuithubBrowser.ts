import type { CircuithubBrowserRequest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { PrimaryEnvironmentHttpClient } from "~/environments/primary/httpClient";
import { runPrimaryHttp } from "~/lib/runtime";

// Uses the existing authenticated primary-environment HTTP client (cookies or bearer).
export const requestCircuithubBrowser = (request: CircuithubBrowserRequest) =>
  runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.circuithub.request({ headers: {}, payload: request })),
    ),
  );
