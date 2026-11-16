import { describe, expect, it } from "vite-plus/test";

import { appendCircuitBuild, circuitBuildKey, completedCircuit } from "./circuitBuildHistory";

const board = (width: number) =>
  JSON.stringify([{ type: "pcb_board", pcb_board_id: "board", width }]);

describe("completed circuit history", () => {
  it("keeps the previous output when the next build is incomplete or failed", () => {
    const previous = appendCircuitBuild([], board(10));
    for (const failed of [
      "[",
      "[]",
      "{}",
      '[{"type":"source_project_metadata"}]',
      '[{"type":"pcb_board"},{"type":"pcb_autorouting_error"}]',
    ]) {
      expect(appendCircuitBuild(previous, failed)).toBe(previous);
    }
    expect(previous[0]?.files.fsMap["completed.circuit.json"]).toBe(board(10));
  });

  it("retains actual completed output for version navigation without rerouting sources", () => {
    const first = appendCircuitBuild([], board(10));
    const versions = appendCircuitBuild(first, board(20));
    expect(versions.map((version) => version.id)).toEqual([1, 2]);
    expect(versions[0]).toBe(first[0]);
    expect(versions[0]?.circuitJsonText).toBe(board(10));
    expect(versions[1]?.circuitJsonText).toBe(board(20));
  });

  it("does not create a version for whitespace changes or repeated polling", () => {
    const versions = appendCircuitBuild([], board(10));
    expect(appendCircuitBuild(versions, JSON.stringify(JSON.parse(board(10)), null, 2))).toBe(
      versions,
    );
  });

  it("bounds history and keeps version numbers increasing after eviction", () => {
    let versions = appendCircuitBuild([], board(1));
    for (let width = 2; width <= 15; width += 1)
      versions = appendCircuitBuild(versions, board(width));
    expect(versions).toHaveLength(10);
    expect(versions[0]?.id).toBe(6);
    expect(versions.at(-1)?.id).toBe(15);
  });

  it("isolates environments, worktrees and circuit entrypoints", () => {
    const key = circuitBuildKey("local", "/project", "index.tsx");
    expect(circuitBuildKey("remote", "/project", "index.tsx")).not.toBe(key);
    expect(circuitBuildKey("local", "/worktree", "index.tsx")).not.toBe(key);
    expect(circuitBuildKey("local", "/project", "other.tsx")).not.toBe(key);
  });

  it("validates elements and reports counts from the completed output", () => {
    expect(
      completedCircuit('[{"type":"pcb_board"},{"type":"pcb_component"},{"type":"pcb_component"}]')
        ?.counts,
    ).toEqual({ pcb_board: 1, pcb_component: 2 });
    expect(completedCircuit("[null]")).toBeNull();
    expect(completedCircuit('[{"type":1}]')).toBeNull();
  });
});
