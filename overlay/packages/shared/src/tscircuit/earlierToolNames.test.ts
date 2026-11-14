import { expect, it } from "vite-plus/test";

import { resolveT3McpToolPresentation } from "../t3McpToolPresentation.ts";

// tscircuit desktop: earlier builds registered the app's tools under T3 Code's name,
// and the threads they wrote still hold it.
it("still names the tools in threads written under T3 Code's tool server name", () => {
  const named = resolveT3McpToolPresentation("mcp__tscircuit-desktop__delegate_task");
  expect(named?.displayName).toBe("Delegate a child task");
  for (const earlier of [
    "mcp__t3-code__delegate_task",
    "mcp__t3_code__delegate_task",
    "t3-code-direct.delegate_task",
    "t3-code.delegate_task",
    "t3-code · delegate_task",
  ]) {
    expect(resolveT3McpToolPresentation(earlier), earlier).toEqual(named);
  }
});
