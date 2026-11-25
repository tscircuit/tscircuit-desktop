import { describe, expect, it } from "vite-plus/test";

import {
  type AutorouterPhase,
  autorouterPhaseSummary,
  autorouterReportScopes,
  defaultAutorouterPhaseId,
  defaultAutorouterReportTitle,
  isSimpleRouteJson,
  readAutorouterPhases,
} from "../../src/tscircuit/autorouterPhases";

const phase = (id: string, rest: Partial<AutorouterPhase> = {}): AutorouterPhase => ({
  id,
  status: "complete",
  ...rest,
});

describe("readAutorouterPhases", () => {
  it("keeps what core says of a phase and drops what is not one", () => {
    expect(
      readAutorouterPhases([
        {
          id: "run1-phase1",
          status: "error",
          errorMessage: "Ran out of iterations",
          subcircuit_id: "subcircuit_source_group_0",
          componentDisplayName: "<board#40 />",
          phaseName: "fanout",
          phaseOrdinal: 1,
          phaseStageIndex: 0,
          phaseStageCount: 2,
          connectionCount: 12,
          obstacleCount: 48,
          isReroutePhase: false,
          solverName: "AutoroutingPipelineSolver",
          preview: {
            bounds: { minX: -5, maxX: 5, minY: -3, maxY: 3 },
            layerCount: 2,
            outline: [[-5, -3]],
            pads: [[1, 2, 0.5, 0.25], [1, 2, "wide"], null],
          },
        },
        { id: "run1-phase2", status: "queued" },
        { status: "running" },
        null,
      ]),
    ).toEqual([
      {
        id: "run1-phase1",
        status: "error",
        errorMessage: "Ran out of iterations",
        subcircuitId: "subcircuit_source_group_0",
        componentDisplayName: "<board#40 />",
        phaseName: "fanout",
        phaseOrdinal: 1,
        phaseStageIndex: 0,
        phaseStageCount: 2,
        connectionCount: 12,
        obstacleCount: 48,
        preview: {
          bounds: { minX: -5, maxX: 5, minY: -3, maxY: 3 },
          layerCount: 2,
          pads: [[1, 2, 0.5, 0.25]],
        },
      },
    ]);
    expect(readAutorouterPhases("phases")).toEqual([]);
  });
});

describe("autorouterReportScopes", () => {
  const titles = (phases: ReadonlyArray<AutorouterPhase>) =>
    autorouterReportScopes(phases).flatMap((scope) =>
      scope.phases.map((entry) => entry.reportTitle),
    );

  it("numbers the phases of one board, and uses a phase's own name", () => {
    expect(
      titles([
        phase("a", { phaseOrdinal: 1 }),
        phase("b", { phaseName: "fanout", phaseStageIndex: 1, phaseStageCount: 3 }),
        phase("c"),
      ]),
    ).toEqual(["Phase 1", "fanout, stage 2 of 3", "Phase 3"]);
  });

  it("says which group a phase routed when several were routed", () => {
    expect(
      titles([
        phase("a", {
          subcircuitId: "group_1",
          componentDisplayName: '<group#12 name=".power" />',
          phaseOrdinal: 1,
        }),
        phase("b", {
          subcircuitId: "group_0",
          componentDisplayName: "<board#40 />",
          phaseOrdinal: 1,
        }),
      ]),
    ).toEqual(["power: Phase 1", "Board: Phase 1"]);
  });

  it("tells boards without names apart, and keeps each board's phases together", () => {
    const board = (id: string, subcircuitId: string, rest: Partial<AutorouterPhase> = {}) =>
      phase(id, { subcircuitId, componentDisplayName: `<board#${id} />`, ...rest });
    const scopes = autorouterReportScopes([
      board("a", "board_0", {
        phaseOrdinal: 1,
        preview: {
          bounds: { minX: -26, maxX: 26, minY: 58, maxY: 150 },
          layerCount: 2,
          outline: [
            [-21, 59],
            [21, 59],
            [21, 149.04],
            [-21, 149.04],
          ],
          pads: [],
        },
      }),
      board("b", "board_1", {
        phaseOrdinal: 1,
        preview: { bounds: { minX: -26, maxX: 26, minY: -50, maxY: 50 }, pads: [] },
      }),
      board("c", "board_0", { phaseOrdinal: 2 }),
    ]);
    expect(
      scopes.map((scope) => [
        scope.label,
        scope.detail,
        scope.phases.map((entry) => entry.reportTitle),
      ]),
    ).toEqual([
      ["Board 1", "42 × 90 mm · 2 layers", ["Board 1: Phase 1", "Board 1: Phase 2"]],
      ["Board 2", "52 × 100 mm", ["Board 2: Phase 1"]],
    ]);
  });
});

it("summarises what a phase was asked to route", () => {
  expect(autorouterPhaseSummary(phase("a", { connectionCount: 1, obstacleCount: 6 }))).toBe(
    "1 connection · 6 obstacles",
  );
  expect(autorouterPhaseSummary(phase("a", { connectionCount: 3, isReroutePhase: true }))).toBe(
    "3 connections · reroutes earlier traces",
  );
  expect(autorouterPhaseSummary(phase("a"))).toBe("");
});

it("picks the phase that failed, else the last one, and none among several boards", () => {
  expect(defaultAutorouterPhaseId([])).toBeNull();
  expect(defaultAutorouterPhaseId([phase("a"), phase("b")])).toBe("b");
  expect(defaultAutorouterPhaseId([phase("a"), phase("b", { status: "error" }), phase("c")])).toBe(
    "b",
  );
  const boards = [phase("a", { subcircuitId: "board_0" }), phase("b", { subcircuitId: "board_1" })];
  expect(defaultAutorouterPhaseId(boards)).toBeNull();
  expect(defaultAutorouterPhaseId([...boards, phase("c", { status: "error" })])).toBe("c");
});

it("titles a report after the project, the file and the phase", () => {
  const title = (cwd: string | undefined) =>
    defaultAutorouterReportTitle({ cwd, file: "boards/main.tsx", phaseTitle: "Phase 2" });
  expect(title("/home/seve/motor-controller/")).toBe("motor-controller/boards/main.tsx - Phase 2");
  expect(title("C:\\work\\motor-controller")).toBe("motor-controller/boards/main.tsx - Phase 2");
  expect(title(undefined)).toBe("boards/main.tsx - Phase 2");
});

describe("isSimpleRouteJson", () => {
  const input = {
    layerCount: 2,
    minTraceWidth: 0.15,
    connections: [],
    obstacles: [],
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
  };

  it("accepts an autorouter input", () => {
    expect(isSimpleRouteJson(input)).toBe(true);
  });

  it.each([
    null,
    [],
    { ...input, layerCount: 0 },
    { ...input, minTraceWidth: 0 },
    { ...input, connections: undefined },
    { ...input, obstacles: {} },
    { ...input, bounds: { ...input.bounds, maxX: -10 } },
    { ...input, bounds: { ...input.bounds, minY: Number.NaN } },
  ])("rejects %j", (value) => {
    expect(isSimpleRouteJson(value)).toBe(false);
  });
});
