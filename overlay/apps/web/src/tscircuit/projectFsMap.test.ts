import { describe, expect, it } from "vite-plus/test";

import { isProjectSourceFile, pickEntryFile, shouldWalkDirectory } from "./projectFsMap";

describe("pickEntryFile", () => {
  it("prefers the entrypoint named in tscircuit.config.json", () => {
    const fsMap = {
      "index.tsx": "",
      "boards/main.tsx": "",
      "tscircuit.config.json": JSON.stringify({ mainEntrypoint: "./boards/main.tsx" }),
    };
    expect(pickEntryFile(fsMap)).toBe("boards/main.tsx");
  });

  it("falls back to index.tsx, then to the shallowest circuit file", () => {
    expect(pickEntryFile({ "lib/part.tsx": "", "index.tsx": "" })).toBe("index.tsx");
    expect(pickEntryFile({ "lib/deep/part.tsx": "", "boards/usb.circuit.tsx": "" })).toBe(
      "boards/usb.circuit.tsx",
    );
    expect(pickEntryFile({ "lib/deep/part.tsx": "", "board.tsx": "" })).toBe("board.tsx");
  });

  it("ignores a configured entrypoint that does not exist, and unreadable config", () => {
    const missing = JSON.stringify({ mainEntrypoint: "gone.tsx" });
    expect(pickEntryFile({ "index.tsx": "", "tscircuit.config.json": missing })).toBe("index.tsx");
    expect(pickEntryFile({ "index.tsx": "", "tscircuit.config.json": "{" })).toBe("index.tsx");
  });

  it("returns null when the project has no .tsx file", () => {
    expect(pickEntryFile({ "package.json": "{}", "lib/math.ts": "" })).toBeNull();
  });
});

describe("which project files are sent to the viewer", () => {
  it("sends source files but not lock files or dotfiles", () => {
    expect(isProjectSourceFile("boards/led.tsx")).toBe(true);
    expect(isProjectSourceFile("package.json")).toBe(true);
    expect(isProjectSourceFile("bun.lock")).toBe(false);
    expect(isProjectSourceFile("package-lock.json")).toBe(false);
    expect(isProjectSourceFile(".eslintrc.json")).toBe(false);
    expect(isProjectSourceFile("docs/board.png")).toBe(false);
  });

  it("skips dependency, build and hidden folders", () => {
    expect(shouldWalkDirectory("lib")).toBe(true);
    expect(shouldWalkDirectory("node_modules")).toBe(false);
    expect(shouldWalkDirectory("packages/a/dist")).toBe(false);
    expect(shouldWalkDirectory(".git")).toBe(false);
  });
});
