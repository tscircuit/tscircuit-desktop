// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import packageJson from "../../package.json" with { type: "json" };
import { resolveHostCliCommand } from "../cli/invocation.ts";
import { REPORT_ENDPOINT, REPORT_ISSUE_URL } from "./reportPlaybook.ts";

/** The service refuses larger bodies; leave room for the other fields. */
const MAX_REPORT_BYTES = 60 * 1024;
const SEND_TIMEOUT = Duration.seconds(20);

export class ReportSendError extends Schema.TaggedError<ReportSendError>()("ReportSendError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return `${this.reason} Nothing was sent. You can open an issue instead: ${REPORT_ISSUE_URL}`;
  }
}

const ReportReply = Schema.Struct({
  ok: Schema.Boolean,
  report_id: Schema.optional(Schema.String),
  truncated: Schema.optional(Schema.Boolean),
  message: Schema.optional(Schema.String),
});
const decodeReportReply = Schema.decodeUnknownEffect(Schema.fromJsonString(ReportReply));

export interface ReportInput {
  readonly report: string;
  readonly title?: string | undefined;
  readonly contact?: string | undefined;
  readonly endpoint?: string | undefined;
}

/** Sends one report. The text is sent as written: redacting it is the writer's job. */
export const sendReport = Effect.fn("tscircuit.sendReport")(function* (input: ReportInput) {
  const report = input.report.trim();
  if (report === "") {
    return yield* new ReportSendError({ reason: "The report is empty." });
  }
  if (new TextEncoder().encode(report).byteLength > MAX_REPORT_BYTES) {
    return yield* new ReportSendError({
      reason: `The report is over ${String(MAX_REPORT_BYTES / 1024)} KB. Shorten it, starting with pasted logs.`,
    });
  }

  const httpClient = yield* HttpClient.HttpClient;
  const body = {
    report,
    title: input.title,
    contact: input.contact,
    app_version: packageJson.version,
    os: `${yield* HostProcess.Platform} ${yield* HostProcess.Architecture} (${NodeOS.release()})`,
    source: "cli",
  };
  const unreachable = new ReportSendError({ reason: "Could not reach the report service." });
  const response = yield* HttpClientRequest.post(input.endpoint ?? REPORT_ENDPOINT).pipe(
    HttpClientRequest.bodyJson(body),
    Effect.flatMap((request) => httpClient.execute(request)),
    Effect.flatMap((sent) =>
      Effect.map(sent.text, (text) => ({ status: sent.status, text }) as const),
    ),
    Effect.mapError(() => unreachable),
    Effect.timeoutOrElse({ duration: SEND_TIMEOUT, orElse: () => Effect.fail(unreachable) }),
  );
  // A proxy or an outage page answers with something that is not the service's JSON.
  const reply = yield* decodeReportReply(response.text).pipe(Effect.option);
  if (response.status !== 200 || Option.isNone(reply) || reply.value.report_id === undefined) {
    const said = Option.flatMap(reply, (value) => Option.fromNullishOr(value.message));
    return yield* new ReportSendError({
      reason: Option.getOrElse(
        said,
        () => `The report service answered with status ${String(response.status)}.`,
      ),
    });
  }
  return { reportId: reply.value.report_id, truncated: reply.value.truncated === true };
});

export const reportCommand = Command.make("report", {
  file: Argument.String("file").pipe(
    Argument.withDescription("Text or Markdown file that holds the report."),
  ),
  title: Flag.String("title").pipe(
    Flag.withDescription("One line that says what went wrong."),
    Flag.optional,
  ),
  contact: Flag.String("contact").pipe(
    Flag.withDescription("Where tscircuit can reach you about it, such as an email address."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Send a written problem report to the tscircuit team. `tscircuit-desktop triage` helps write one.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const report = yield* fs
        .readFileString(flags.file)
        .pipe(
          Effect.mapError(() => new ReportSendError({ reason: `Could not read ${flags.file}.` })),
        );
      // A test or a self-hosted copy of the service can stand in for tscircuit's.
      const endpoint = yield* Config.String("TSCIRCUIT_DESKTOP_REPORT_URL").pipe(Config.option);
      const sent = yield* sendReport({
        report,
        title: Option.getOrUndefined(flags.title),
        contact: Option.getOrUndefined(flags.contact),
        endpoint: Option.getOrUndefined(endpoint),
      });
      yield* Console.log(
        [
          `Report sent to tscircuit. Reference: ${sent.reportId}`,
          ...(sent.truncated
            ? ["It was longer than the service accepts, so its end was cut."]
            : []),
        ].join("\n"),
      );
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  ),
);

const reportCommandSection = (command: string) => `
## Sending a report

- Report command (add the report file's path, and \`--title\`): ${command}
- If it is missing or fails, the playbook's step 10 says what to do instead.
`;

/**
 * Adds how to send a report to a triage context file. The command is this
 * install's own launcher, so it works when \`tscircuit-desktop\` is not on PATH.
 */
export const appendReportCommand = Effect.fn("tscircuit.appendReportCommand")(function* (
  contextFilePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const { command } = yield* resolveHostCliCommand("report");
  const context = yield* fs.readFileString(contextFilePath);
  yield* fs.writeFileString(contextFilePath, `${context}${reportCommandSection(command)}`);
});
