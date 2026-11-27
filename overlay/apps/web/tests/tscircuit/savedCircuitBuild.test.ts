import { expect, it } from "vite-plus/test";
import { isDrawableCircuitBuild } from "../../src/tscircuit/savedCircuitBuild";

it("accepts drawable build artifacts within the UTF-8 size limit", () => {
  expect(isDrawableCircuitBuild('[{"type":"pcb_board"}]')).toBe(true);
  for (const text of ["invalid", "[]", "[null]", '[{"type":"source_component"}]'])
    expect(isDrawableCircuitBuild(text)).toBe(false);
  const oversized = JSON.stringify([{ type: "pcb_board", text: "😃".repeat(6 * 1024 * 1024) }]);
  expect(isDrawableCircuitBuild(oversized)).toBe(false);
});
