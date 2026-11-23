import { describe, expect, it } from "vite-plus/test";
import { createCircuithubService, validateProject } from "./service.ts";
import { checkoutUrl } from "./api.ts";
import { tokenClaims } from "./login.ts";
import type { CircuithubRequest } from "@t3tools/contracts";

const TOKEN = `header.${Buffer.from(JSON.stringify({ name: "Test User", exp: 40_000_000_000 })).toString("base64url")}.signature`;
const input = (): Extract<CircuithubRequest, { action: "create" }> => ({
  action: "create",
  workspace: "my-team",
  projectName: "board",
  projectId: null,
  exportClassification: "EAR99",
  quantities: [1, 5],
  files: ["kicad_sch", "kicad_pcb", "kicad_pro"].map((ext) => ({
    filename: `board.${ext}`,
    content: "design",
  })),
});
function setup(
  options: {
    failAuth?: boolean;
    initialToken?: string | null;
    importFailed?: boolean;
    provisional?: boolean;
  } = {},
) {
  const calls: { url: string; method: string; headers: Headers; body: unknown }[] = [];
  let stored = options.initialToken === undefined ? TOKEN : options.initialToken;
  const fetchFn: typeof fetch = async (url, init) => {
    const value = String(url);
    calls.push({
      url: value,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    if (value.startsWith("https://storage.example/")) return new Response(null, { status: 200 });
    if (options.failAuth) return new Response("not authorized", { status: 401 });
    const endpoint = new URL(value).pathname;
    if (endpoint === "/v1/workspaces")
      return json({
        workspaces: [
          { id: 1, slug: "my-team", name: "My team" },
          { id: 2, slug: "personal" },
        ],
      });
    if (endpoint === "/v1/projects/upload-urls")
      return json({
        uploads: input().files.map((file) => ({
          filename: file.filename,
          objectKey: `key/${file.filename}`,
          uploadUrl: `https://storage.example/${file.filename}`,
          headers: [["x-upload-test", "yes"]],
        })),
      });
    if (endpoint === "/v1/projects" || endpoint.endsWith("/revisions"))
      return json({ projectId: 12, revisionId: 24 });
    if (endpoint.endsWith("/status"))
      return json({ status: options.importFailed ? "failed" : "complete" });
    if (endpoint.endsWith("/board"))
      return json({
        hasCamReport: !options.provisional,
        spec: { minPitchMM: 0.15, minHoleSizeMM: 0.3 },
      });
    if (endpoint.endsWith("/bom"))
      return json({ bomLines: [{ status: "unresolved", placements: [{ ref: "U1" }] }] });
    if (endpoint === "/v1/quotes") {
      const body = JSON.parse(String(init?.body));
      return json({
        id: body.quantity,
        quantity: body.quantity,
        status: "complete",
        orderable: true,
        offers: [
          {
            id: 7,
            service: "Grid Proto",
            checkoutUrl: "https://app.circuithub.com/checkout/7",
            price: { manufacturingTotal: "125.50", manufacturingUnitPrice: "25.10" },
          },
        ],
      });
    }
    throw new Error(`Unexpected URL: ${value}`);
  };
  const service = createCircuithubService({
    readToken: async () => stored,
    writeToken: async (value) => {
      stored = value;
      return true;
    },
    clearToken: async () => {
      stored = null;
    },
    openBrowser: async () => true,
    fetch: fetchFn,
  });
  return { service, calls, stored: () => stored };
}

describe("CircuitHub integration", () => {
  it("quotes the complete project without leaking credentials to upload URLs or the renderer", async () => {
    const { service, calls } = setup();
    const result = await service.request(input());
    expect(result.ok).toBe(true);
    expect(result.quote).toMatchObject({
      projectId: 12,
      revisionId: 24,
      camReady: true,
      unresolvedParts: ["U1"],
    });
    expect(result.quote?.quotes.map((q) => q.quantity)).toEqual([1, 5]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    const uploads = calls.filter((call) => call.url.startsWith("https://storage.example/"));
    expect(uploads).toHaveLength(3);
    expect(uploads.every((call) => !call.headers.has("Authorization"))).toBe(true);
    expect(
      calls
        .filter((call) => call.url.startsWith("https://api.circuithub.com/"))
        .every((call) => call.headers.get("Authorization") === `Bearer ${TOKEN}`),
    ).toBe(true);
    expect(calls.some((call) => /order|purchase/.test(new URL(call.url).pathname))).toBe(false);
    service.close();
  });

  it("refreshes an uploaded revision without uploading or creating another project", async () => {
    const { service, calls } = setup({ provisional: true });
    const result = await service.request({
      action: "refresh",
      projectId: 12,
      revisionId: 24,
      quantities: [5],
    });
    expect(result.quote?.camReady).toBe(false);
    expect(
      calls.some((call) => call.url.includes("upload") || call.url.endsWith("/projects")),
    ).toBe(false);
    service.close();
  });

  it("lists only account workspaces with a fallback label and never returns the bearer", async () => {
    const { service, calls } = setup();
    try {
      const response = await service.request({ action: "workspaces" });
      expect(response.ok).toBe(true);
      expect(response.workspaces).toEqual([
        { slug: "my-team", name: "My team" },
        { slug: "personal", name: "personal" },
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://api.circuithub.com/v1/workspaces");
      expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
      expect(JSON.stringify(response)).not.toContain(TOKEN);
    } finally {
      service.close();
    }
  });

  it("requires sign-in and clears expired sessions after an API rejection", async () => {
    const disconnected = setup({ initialToken: null });
    expect((await disconnected.service.request(input())).error).toMatch(/Sign in/);
    expect(disconnected.calls).toHaveLength(0);
    const expired = setup({ failAuth: true });
    const response = await expired.service.request(input());
    expect(response.account.connected).toBe(false);
    expect(response.error).toMatch(/session expired/);
    expect(expired.stored()).toBeNull();
    const listExpired = setup({ failAuth: true });
    const listResponse = await listExpired.service.request({ action: "workspaces" });
    expect(listResponse.account.connected).toBe(false);
    expect(listResponse.error).toMatch(/session expired/);
    expect(listExpired.stored()).toBeNull();
    listExpired.service.close();
    disconnected.service.close();
    expired.service.close();
  });

  it("does not clear a newly linked account after an older workspace request returns 401", async () => {
    const entered = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    let saved: string | null = TOKEN;
    let loginUrl = "";
    const next = `header.${Buffer.from(JSON.stringify({ name: "New account", exp: 40_000_000_000 })).toString("base64url")}.signature`;
    const service = createCircuithubService({
      readToken: async () => saved,
      writeToken: async (token) => {
        saved = token;
        return true;
      },
      clearToken: async () => {
        saved = null;
      },
      openBrowser: async (url) => {
        loginUrl = url;
        return true;
      },
      fetch: async () => {
        entered.resolve();
        return response.promise;
      },
    });
    try {
      const pending = service.request({ action: "workspaces" });
      await entered.promise;
      await service.request({ action: "logout" });
      await service.request({ action: "login" });
      const callback = new URL(new URL(loginUrl).searchParams.get("redirect_uri")!);
      callback.searchParams.set("token", next);
      expect(
        (await service.request({ action: "complete_login", callbackUrl: callback.href })).ok,
      ).toBe(true);
      response.resolve(new Response("expired", { status: 401 }));
      const stale = await pending;
      expect(stale.ok).toBe(false);
      expect(stale.account).toMatchObject({ connected: true, displayName: "New account" });
      expect(saved).toBe(next);
    } finally {
      service.close();
    }
  });

  it("rejects unsafe and incomplete projects before making any network request", async () => {
    const { service, calls } = setup();
    for (const request of [
      { ...input(), exportClassification: "" },
      { ...input(), workspace: "https://other.example/" },
      { ...input(), files: [{ filename: "../board.kicad_pcb", content: "private" }] },
      { ...input(), files: input().files.slice(0, 2) },
      { ...input(), files: [...input().files, input().files[0]!] },
    ]) {
      expect((await service.request(request)).ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
    expect(() => validateProject(input())).not.toThrow();
    service.close();
  });

  it("does not ask for prices when CircuitHub cannot import the design", async () => {
    const { service, calls } = setup({ importFailed: true });
    expect((await service.request(input())).error).toMatch(/could not import/);
    expect(calls.some((call) => call.url.endsWith("/quotes"))).toBe(false);
    service.close();
  });

  it("cancels an import and prevents concurrent quotes", async () => {
    const reachedImport = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const fake = async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/upload-urls"))
        return new Response(
          JSON.stringify({
            uploads: input().files.map((f) => ({
              filename: f.filename,
              objectKey: f.filename,
              uploadUrl: `https://storage.example/${f.filename}`,
              headers: [],
            })),
          }),
        );
      if (path === "/v1/projects")
        return new Response(JSON.stringify({ projectId: 12, revisionId: 24 }));
      if (path.endsWith("/status")) {
        reachedImport.resolve();
        await resume.promise;
        return new Response(JSON.stringify({ status: "importing" }));
      }
      if (init?.method === "PUT") return new Response(null);
      throw new Error("Unexpected API call");
    };
    const service = createCircuithubService({
      readToken: async () => TOKEN,
      writeToken: async () => true,
      clearToken: async () => {},
      openBrowser: async () => true,
      fetch: fake,
      pause: async (signal) => signal.throwIfAborted(),
    });
    const pending = service.request(input());
    await reachedImport.promise;
    expect((await service.request(input())).error).toMatch(/already running/);
    await service.request({ action: "cancel" });
    resume.resolve();
    expect((await pending).error).toMatch(/cancelled/);
    expect((await service.request({ action: "status" })).account.progress).toBeNull();
    service.close();
  });

  it("does not save a late login callback after disconnect", async () => {
    const received = Promise.withResolvers<string>();
    let writes = 0;
    const service = createCircuithubService({
      readToken: async () => null,
      writeToken: async () => {
        writes++;
        return true;
      },
      clearToken: async () => {},
      openBrowser: async () => true,
      login: async () => ({
        url: "https://app.circuithub.com/platform/v1/auth/cli",
        token: received.promise,
        acceptCallback: () => false,
        close() {},
      }),
    });
    expect((await service.request({ action: "login" })).account.loginPending).toBe(true);
    await service.request({ action: "logout" });
    received.resolve(TOKEN);
    expect((await service.request({ action: "status" })).account.connected).toBe(false);
    expect(writes).toBe(0);
    service.close();
  });

  it("only exposes valid CircuitHub checkout links and unexpired session claims", () => {
    expect(checkoutUrl("https://app.circuithub.com/checkout/123")).not.toBeNull();
    for (const url of [
      "javascript:alert(1)",
      "https://circuithub.com.evil.example/",
      "https://user:secret@circuithub.com/",
      "https://evil.example/",
    ])
      expect(checkoutUrl(url)).toBeNull();
    expect(tokenClaims(TOKEN)?.name).toBe("Test User");
    expect(tokenClaims("not a token")).toBeNull();
    expect(tokenClaims(`h.${Buffer.from('{"exp":1}').toString("base64url")}.s`)).toBeNull();
  });
});
