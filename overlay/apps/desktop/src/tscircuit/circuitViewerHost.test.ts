import { describe, expect, it } from "vite-plus/test";

import { makeViewerContentSecurityPolicy, routeViewerRequest } from "./circuitViewerHost.ts";

const route = (requestUrl: string, method = "GET") =>
  routeViewerRequest({ requestUrl, method, appHost: "app" });

describe("routeViewerRequest", () => {
  it("leaves the app's own requests alone, also for the viewer's files", () => {
    for (const url of [
      "tscircuit-desktop://app/",
      "tscircuit-desktop://app/tscircuit-viewer/frame.html",
      "tscircuit-desktop://app/index.html?next=//viewer/frame.html",
      "not a url",
    ]) {
      expect(route(url)).toEqual({ kind: "app" });
    }
  });

  it("finds the viewer's files where the app's host keeps them", () => {
    expect(route("tscircuit-desktop://viewer/frame.html")).toEqual({
      kind: "viewer",
      appUrl: "tscircuit-desktop://app/tscircuit-viewer/frame.html",
    });
    expect(route("tscircuit-desktop-dev://viewer/runframe.min.js?v=1", "HEAD")).toEqual({
      kind: "viewer",
      appUrl: "tscircuit-desktop-dev://app/tscircuit-viewer/runframe.min.js",
    });
  });

  it("serves nothing else on the viewer's host, so the app never runs in that origin", () => {
    for (const url of [
      "tscircuit-desktop://viewer/",
      "tscircuit-desktop://viewer/index.html",
      "tscircuit-desktop://viewer/frame.html/x",
      "tscircuit-desktop://viewer/../index.html",
      "tscircuit-desktop://viewer/%2e%2e/index.html",
      "tscircuit-desktop://viewer/assets/main.js",
    ]) {
      expect(route(url)).toEqual({ kind: "not_found" });
    }
    expect(route("tscircuit-desktop://viewer/frame.html", "POST")).toEqual({ kind: "not_found" });
  });
});

describe("makeViewerContentSecurityPolicy", () => {
  it("lets the viewer evaluate code and only the app frame it", () => {
    const policy = makeViewerContentSecurityPolicy("tscircuit-desktop");
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("frame-ancestors tscircuit-desktop:");
  });
});
