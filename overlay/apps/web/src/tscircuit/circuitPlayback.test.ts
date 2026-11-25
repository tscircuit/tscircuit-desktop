import * as NodeVM from "node:vm";
import { expect, it } from "vite-plus/test";
import adapter from "../../public/tscircuit-viewer/preview-events.js?raw";
import {
  type CircuitPreviewEvent,
  type CircuitPlaybackStep,
  PREVIEW_REQUEST_FILE,
  recordCircuitPreviewEvent,
  recordBuildSnapshot,
  findSnapshotStep,
} from "./circuitPlayback";

it("bounds retained history and preserves failed output separately from missing output", () => {
  let history: ReadonlyArray<CircuitPlaybackStep> = [];
  for (let i = 0; i < 45; i += 1)
    history = recordBuildSnapshot(history, JSON.stringify([{ type: "pcb_board", id: i }]), i);
  expect(history).toHaveLength(40);
  expect(history.filter((step) => step.snapshot !== null)).toHaveLength(10);
  expect(history[0]).toMatchObject({ snapshot: null, snapshotEvicted: true });
  expect(recordBuildSnapshot(history, history.at(-1)!.snapshot!, 46)).toBe(history);

  const output = '[{"type":"pcb_board"},{"type":"pcb_autorouting_error"}]';
  const event: CircuitPreviewEvent = {
    previewId: "preview",
    sequence: 0,
    observedAt: 46,
    stage: "failed",
  };
  history = recordCircuitPreviewEvent(history, { ...event, circuitJsonText: output });
  history = recordCircuitPreviewEvent(history, {
    ...event,
    sequence: 1,
  });
  expect(history.at(-1)?.snapshot).toBeNull();
  expect(findSnapshotStep(history, "preview:1")?.snapshot).toBe(output);
  expect(recordCircuitPreviewEvent(history, { ...event, sequence: 1 })).toBe(history);
  const undated: CircuitPlaybackStep = {
    id: "disk",
    at: null,
    label: "Disk build",
    archivePath: "dist/index/circuit.json",
    snapshot: null,
    bytes: 0,
  };
  const noOutput = recordCircuitPreviewEvent([undated], event);
  expect(findSnapshotStep(noOutput, "preview:0")).toBeNull();
  expect(findSnapshotStep(noOutput, "disk")).toBe(undated);
});

it("enforces the UTF-8 byte budget for individual and accumulated snapshots", () => {
  const oversized = JSON.stringify([{ type: "pcb_board", text: "😃".repeat(6 * 1024 * 1024) }]);
  expect(recordBuildSnapshot([], oversized, 0)).toEqual([]);
  const snapshot = (id: number) =>
    JSON.stringify([{ type: "pcb_board", id, text: "x".repeat(11 * 1024 * 1024) }]);
  const history = recordBuildSnapshot(recordBuildSnapshot([], snapshot(1), 1), snapshot(2), 2);
  expect(history[0]?.snapshotEvicted).toBe(true);
  expect(history.filter((step) => step.snapshot !== null)).toHaveLength(1);
});

it("discards superseded worker snapshots and invokes remote methods without .call or .apply", async () => {
  const events: CircuitPreviewEvent[] = [];
  let resolveSnapshot!: (value: unknown) => void;
  const worker = {
    on: () => {},
    executeWithFsMap: async (_input: unknown) => {},
    renderUntilSettled: async () => {},
    getCircuitJson: () =>
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
  };
  for (const method of [worker.renderUntilSettled, worker.getCircuitJson])
    for (const property of ["apply", "call"])
      Object.defineProperty(method, property, {
        get() {
          throw new Error("Remote method property");
        },
      });
  const context = {
    self: {} as { tscircuitDesktopObservePreviewWorker: (worker: unknown) => void },
    window: {
      parent: {
        postMessage: (message: { event: CircuitPreviewEvent }) => events.push(message.event),
      },
    },
  };
  NodeVM.runInNewContext(adapter, context);
  context.self.tscircuitDesktopObservePreviewWorker(worker);
  await worker.executeWithFsMap({ fsMap: { [PREVIEW_REQUEST_FILE]: "old" } });
  await worker.renderUntilSettled();
  await worker.executeWithFsMap({ fsMap: { [PREVIEW_REQUEST_FILE]: "current" } });
  resolveSnapshot([{ type: "pcb_board" }]);
  await Promise.resolve();
  expect(events.map((event) => [event.previewId, event.stage])).toEqual([
    ["old", "started"],
    ["current", "started"],
  ]);
});
