import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { FetchHttpClient } from "effect/http";

import packageJson from "../../package.json" with { type: "json" };
import * as ServerConfig from "../config.ts";
import { writeTriageSession } from "../triage/triageSession.ts";
import { sendReport } from "./reportCommand.ts";
import { REPORT_ENDPOINT, REPORT_ISSUE_URL, REPORT_PLAYBOOK } from "./reportPlaybook.ts";

interface SentRequest {
  readonly url: string;
  readonly contentType: string | null;
  readonly body: Record<string, unknown>;
}

/** Stands in for the report service: records what it was sent and answers as told. */
const service = (status: number, answer: string) => {
  const requests: Array<SentRequest> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push({
      url: request.url,
      contentType: request.headers.get("content-type"),
      body: JSON.parse(await request.text()) as Record<string, unknown>,
    });
    return new Response(answer, { status });
  };
  return { requests, fetch };
};

const send = (input: Parameters<typeof sendReport>[0], fetch: typeof globalThis.fetch) =>
  sendReport(input).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
  );

it.effect("sends the report with this build's version and returns the reference", () =>
  Effect.gen(function* () {
    const { requests, fetch } = service(200, '{"ok":true,"report_id":"R-7F3K2A"}');

    const sent = yield* send(
      { report: "The PCB view stays blank.\n", title: "Blank PCB view", contact: undefined },
      fetch,
    ).pipe(
      Effect.provideService(HostProcess.Platform, "darwin"),
      Effect.provideService(HostProcess.Architecture, "arm64"),
    );

    assert.deepEqual(sent, { reportId: "R-7F3K2A", truncated: false });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, REPORT_ENDPOINT);
    assert.equal(requests[0]?.contentType, "application/json");
    assert.equal(requests[0]?.body.report, "The PCB view stays blank.");
    assert.equal(requests[0]?.body.title, "Blank PCB view");
    assert.equal(requests[0]?.body.app_version, packageJson.version);
    assert.match(String(requests[0]?.body.os), /^darwin arm64 \(.+\)$/);
    assert.notProperty(requests[0]?.body, "contact");
  }),
);

it.effect("a refusal says why, that nothing was sent, and where else to report", () =>
  Effect.gen(function* () {
    const refusal = '{"ok":false,"error":"rate_limited","message":"Too many reports just now."}';
    const cases = [
      { ...service(429, refusal), says: "Too many reports just now." },
      // An outage page or a proxy, not the service's own answer.
      { ...service(502, "<html>Bad gateway</html>"), says: "status 502" },
      // A stranger answering on the address must not pass for a sent report.
      { ...service(200, '{"ok":true}'), says: "status 200" },
      {
        requests: [],
        fetch: () => Promise.reject(new Error("connection refused")),
        says: "Could not reach the report service.",
      },
    ];
    for (const { fetch, says } of cases) {
      const error = yield* send({ report: "text" }, fetch).pipe(Effect.flip);

      assert.include(error.message, says);
      assert.include(error.message, "Nothing was sent.");
      assert.include(error.message, REPORT_ISSUE_URL);
    }
  }),
);

it.effect("an empty or oversized report is refused before anything is sent", () =>
  Effect.gen(function* () {
    for (const report of ["  \n", "x".repeat(61 * 1024)]) {
      const { requests, fetch } = service(200, '{"ok":true,"report_id":"R-7F3K2A"}');

      const error = yield* send({ report }, fetch).pipe(Effect.flip);

      assert.equal(error._tag, "ReportSendError");
      assert.equal(requests.length, 0);
    }
  }),
);

it.effect("a triage session follows tscircuit's playbook and says how to send the report", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "tscircuit-report-" });
    const paths = yield* ServerConfig.deriveServerPaths(baseDir, undefined, {});

    const session = yield* writeTriageSession({
      baseDir,
      paths,
      entry: { kind: "app", client: "tscircuit desktop version 0.1.12 on macos" },
      server: "running (pid 42, version 0.1.12); this session runs inside it",
    });

    const prompt = yield* fs.readFileString(session.promptFilePath);
    assert.include(prompt, REPORT_PLAYBOOK);
    // T3 Code's playbook files issues in T3 Code's repository.
    assert.notInclude(prompt, "pingdotgg/t3code/issues");
    assert.notInclude(prompt, "gh issue create");

    const context = yield* fs.readFileString(session.contextFilePath);
    assert.include(context, "- Repo: https://github.com/tscircuit/tscircuit-desktop");
    assert.match(context, /- Report command \(.*\): .*tscircuit-desktop report$/m);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it("the playbook's steps match what the context file refers to", () => {
  // The context file sends the agent to "step 4" to clone the source.
  assert.include(REPORT_PLAYBOOK, "## 4. Get the source");
  assert.include(REPORT_PLAYBOOK, REPORT_ENDPOINT);
});
