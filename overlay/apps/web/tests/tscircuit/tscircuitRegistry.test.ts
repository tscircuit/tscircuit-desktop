import { describe, expect, it } from "vite-plus/test";

import {
  createAutorouterBugReport,
  signInToTscircuit,
} from "../../src/tscircuit/tscircuitRegistry";

interface Call {
  readonly path: string;
  readonly authorization: string | null;
  readonly body: unknown;
}

/** A registry that answers each request with the next reply in line. */
function registry(replies: ReadonlyArray<{ readonly status?: number; readonly body?: unknown }>) {
  const calls: Call[] = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    calls.push({
      path: new URL(String(url)).pathname,
      authorization: new Headers(init?.headers).get("Authorization"),
      body: JSON.parse(String(init?.body)),
    });
    const reply = replies[calls.length - 1];
    return Response.json(reply?.body ?? null, { status: reply?.status ?? 200 });
  };
  return { calls, fetch: fakeFetch };
}

const SRJ = { layerCount: 2 };
const noWait = async () => {};

describe("signInToTscircuit", () => {
  const page = {
    login_page_id: "page_1",
    login_page_auth_token: "page-token",
    url: "https://tscircuit.com/authorize?session=1",
  };

  it("opens the sign-in page, waits for the user, and trades the page for a session", async () => {
    const { calls, fetch } = registry([
      { body: { login_page: page } },
      { body: { login_page: { was_login_successful: false } } },
      { body: { login_page: { was_login_successful: true } } },
      { body: { session: { token: "session-token" } } },
    ]);
    const opened: string[] = [];
    const result = await signInToTscircuit({
      fetch,
      signal: new AbortController().signal,
      wait: noWait,
      openUrl: async (url) => void opened.push(url),
    });
    expect(result).toEqual({ kind: "signed_in", token: "session-token" });
    expect(opened).toEqual([page.url]);
    expect(calls).toEqual([
      { path: "/sessions/login_page/create", authorization: null, body: {} },
      {
        path: "/sessions/login_page/get",
        authorization: "Bearer page-token",
        body: { login_page_id: "page_1" },
      },
      {
        path: "/sessions/login_page/get",
        authorization: "Bearer page-token",
        body: { login_page_id: "page_1" },
      },
      {
        path: "/sessions/login_page/exchange_for_cli_session",
        authorization: "Bearer page-token",
        body: { login_page_id: "page_1" },
      },
    ]);
  });

  it("gives up when the sign-in page expires or the registry refuses", async () => {
    const options = {
      signal: new AbortController().signal,
      wait: noWait,
      openUrl: async () => {},
    };
    expect(
      await signInToTscircuit({
        ...options,
        ...registry([
          { body: { login_page: page } },
          { body: { login_page: { is_expired: true } } },
        ]),
      }),
    ).toEqual({ kind: "expired" });
    expect(
      await signInToTscircuit({
        ...options,
        ...registry([{ status: 500, body: { error: { message: "Registry is down" } } }]),
      }),
    ).toEqual({ kind: "failed", message: "Registry is down" });
  });
});

describe("createAutorouterBugReport", () => {
  const report = (fetch: typeof globalThis.fetch, signal = new AbortController().signal) =>
    createAutorouterBugReport({
      fetch,
      signal,
      title: "motor/index.tsx - Phase 1",
      simpleRouteJson: SRJ,
      token: "session-token",
    });

  it("sends the title and the routing problem, and links to the report", async () => {
    const { calls, fetch } = registry([
      { body: { autorouting_bug_report: { autorouting_bug_report_id: "report 1" } } },
    ]);
    expect(await report(fetch)).toEqual({
      kind: "created",
      url: "https://api.tscircuit.com/autorouting/bug_reports/view?autorouting_bug_report_id=report%201",
    });
    expect(calls).toEqual([
      {
        path: "/autorouting/bug_reports/create",
        authorization: "Bearer session-token",
        body: { title: "motor/index.tsx - Phase 1", simple_route_json: SRJ },
      },
    ]);
  });

  it.each([
    [{ status: 401 }, { kind: "sign_in_required" }],
    [{ status: 413 }, { kind: "too_large" }],
    [
      { status: 400, body: { error: { message: "simple_route_json is invalid" } } },
      { kind: "failed", message: "simple_route_json is invalid" },
    ],
    [{ status: 502 }, { kind: "failed", message: "The tscircuit registry answered 502." }],
    [{ body: {} }, { kind: "failed", message: "The tscircuit registry did not return a report." }],
  ])("reads the reply %j", async (reply, expected) => {
    expect(await report(registry([reply]).fetch)).toEqual(expected);
  });

  it("reports a network failure, but lets a cancelled request reject", async () => {
    const offline: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await report(offline)).toEqual({ kind: "failed", message: "Failed to fetch" });
    const request = new AbortController();
    request.abort();
    await expect(report(offline, request.signal)).rejects.toThrow("Failed to fetch");
  });
});
