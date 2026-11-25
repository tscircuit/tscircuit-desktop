import * as NodeVM from "node:vm";
import { expect, it } from "vite-plus/test";
import adapter from "../../public/tscircuit-viewer/playback.js?raw";
import {
  type CircuitObservation,
  type CircuitPlaybackStep,
  readCircuitObservation,
  recordCircuitObservation,
  recordBuiltCheckpoint,
  playbackSnapshot,
} from "./circuitPlayback";

it("retains bounded immutable snapshots and explicit failures, deduplicating repeated events", () => {
  const json = (i: number) => JSON.stringify([{ type: "pcb_board", pcb_board_id: String(i) }]);
  let history: ReadonlyArray<CircuitPlaybackStep> = [];
  for (let i = 0; i < 12; i += 1) history = recordBuiltCheckpoint(history, json(i), i);
  expect(history.filter((step) => step.snapshot !== null)).toHaveLength(10);
  expect(history[0]?.snapshot).toBeNull();
  expect(recordBuiltCheckpoint(history, json(11), 20)).toBe(history);
  const failed: CircuitObservation = { requestId: "attempt", sequence: 0, at: 21, stage: "failed" };
  history = recordCircuitObservation(history, failed);
  expect(recordCircuitObservation(history, failed)).toBe(history);
  expect(history.at(-1)).toMatchObject({ label: "Preview attempt failed", snapshot: null });
  expect(playbackSnapshot(history, "attempt:0")?.snapshot).toBe(json(11));
  expect(playbackSnapshot(history, "evicted")).toBeNull();
  history = recordCircuitObservation(history, {
    ...failed,
    sequence: 1,
    stage: "completed",
    circuitJsonText: '[{"type":"pcb_board"},{"type":"pcb_trace_error"}]',
  });
  expect(history.at(-1)).toMatchObject({ errorCount: 1 });
  history = recordCircuitObservation(history, {
    ...failed,
    sequence: 60,
    stage: "failed",
    circuitJsonText: json(100),
  });
  expect(history.at(-1)).toMatchObject({ label: "Preview attempt failed", snapshot: json(100) });
  const routing = recordCircuitObservation([], {
    ...failed,
    stage: "completed",
    circuitJsonText: '[{"type":"pcb_board"},{"type":"pcb_autorouting_error"}]',
  });
  expect(routing.at(-1)).toMatchObject({ label: "Routing failed · 1 error record" });
  for (let i = 2; i < 59; i += 1)
    history = recordCircuitObservation(history, { ...failed, sequence: i });
  expect(history).toHaveLength(40);
  expect(history.some((step) => step.id === "attempt:0")).toBe(false);
});

it("rejects malformed or oversized observations and snapshots, including UTF-8 byte overflow", () => {
  expect(
    readCircuitObservation({ requestId: "x", sequence: NaN, at: 1, stage: "completed" }),
  ).toBeNull();
  expect(
    readCircuitObservation({ requestId: "x", sequence: 1, at: Infinity, stage: "completed" }),
  ).toBeNull();
  expect(
    readCircuitObservation({
      requestId: "x",
      sequence: 1,
      at: 1,
      stage: "routing",
      phaseStatus: "unknown",
    }),
  ).toBeNull();
  expect(
    readCircuitObservation({
      requestId: "x",
      sequence: 1,
      at: 1,
      stage: "checks",
      checks: ["unknown"],
    }),
  ).toBeNull();
  for (const text of [
    "[{}",
    "[]",
    '[{"type":1}]',
    JSON.stringify([{ type: "pcb_board", text: "😃".repeat(6 * 1024 * 1024) }]),
  ]) {
    expect(recordBuiltCheckpoint([], text, 0)).toEqual([]);
  }
  const text = JSON.stringify([{ type: "pcb_board", text: "x".repeat(11 * 1024 * 1024) }]);
  const history = recordBuiltCheckpoint(
    recordBuiltCheckpoint([], text, 1),
    text.replace('"pcb_board"', '"pcb_component"'),
    2,
  );
  expect(history.filter((step) => step.snapshot !== null)).toHaveLength(1);
  expect(history.reduce((total, step) => total + step.bytes, 0)).toBeLessThanOrEqual(
    20 * 1024 * 1024,
  );
});

it("observes the real worker boundary without running it for playback, dropping late artifacts", async () => {
  const observations: CircuitObservation[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  let complete!: () => void;
  let read!: (value: unknown) => void;
  const worker = {
    on: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn),
    executeWithFsMap: async (args: { fsMap: Record<string, string> }) => {
      if (args.fsMap.fail) throw new Error("real compile failure");
    },
    renderUntilSettled: () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    getCircuitJson: () =>
      new Promise((resolve) => {
        read = resolve;
      }),
  };
  const context = {
    self: {} as { tscircuitDesktopTapPlayback: (worker: unknown) => void },
    window: {
      parent: {
        postMessage: (message: { observation: CircuitObservation }) =>
          observations.push(message.observation),
      },
    },
  };
  // Comlink methods expose remote properties: .apply/.call become RPC paths, not Function helpers.
  for (const method of [worker.renderUntilSettled, worker.getCircuitJson]) {
    Object.defineProperties(method, {
      apply: {
        get() {
          throw new Error("remote .apply");
        },
      },
      call: {
        get() {
          throw new Error("remote .call");
        },
      },
    });
  }
  NodeVM.runInNewContext(adapter, context);
  context.self.tscircuitDesktopTapPlayback(worker);
  worker.on("autorouting:error", () => {});
  worker.on("board:renderPhaseStarted", () => {});
  await worker.executeWithFsMap({ fsMap: { ".tscircuit-desktop/playback-request": "a" } });
  listeners.get("board:renderPhaseStarted")?.({ phase: "PcbDesignRuleChecks" });
  expect(observations.at(-1)).toMatchObject({ stage: "checks", checks: ["pcb"] });
  listeners.get("autorouting:error")?.({ isReroutePhase: true });
  expect(observations.at(-1)).toMatchObject({
    requestId: "a",
    stage: "routing",
    phaseStatus: "error",
    reroute: true,
  });
  const pending = worker.renderUntilSettled();
  complete();
  await pending;
  await worker.executeWithFsMap({ fsMap: { ".tscircuit-desktop/playback-request": "b" } });
  read([{ type: "pcb_board" }]);
  await Promise.resolve();
  expect(observations.filter((event) => event.stage === "completed")).toEqual([]);
  await expect(
    worker.executeWithFsMap({
      fsMap: { ".tscircuit-desktop/playback-request": "c", fail: "true" },
    }),
  ).rejects.toThrow("real compile failure");
  expect(observations.at(-1)).toMatchObject({ requestId: "c", stage: "failed" });
  expect(observations.at(-1)?.circuitJsonText).toBeUndefined();
});
