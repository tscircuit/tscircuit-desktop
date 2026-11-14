import { describe, expect, it } from "vite-plus/test";

import { viewerFrame } from "./viewerFrame";

describe("viewerFrame", () => {
  it("frames the desktop app's viewer host, which is an origin of its own", () => {
    expect(viewerFrame({ desktop: true, protocol: "tscircuit-desktop:", baseUrl: "/" })).toEqual({
      src: "tscircuit-desktop://viewer/frame.html",
      sandbox: "allow-scripts allow-same-origin",
      targetOrigin: "tscircuit-desktop://viewer",
    });
  });

  it("takes the frame's origin away in a browser, where it would be the app's", () => {
    const frame = viewerFrame({ desktop: false, protocol: "http:", baseUrl: "/" });
    expect(frame.src).toBe("/tscircuit-viewer/frame.html");
    expect(frame.sandbox.split(" ")).not.toContain("allow-same-origin");
  });
});
