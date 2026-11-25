import type { ComponentProps } from "react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "~/rightPanelStore";
import { CircuitSplitControl } from "./CircuitSplitControl";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../test/render";
import type { ComposerThreadTarget } from "~/composerDraftStore";
import { PREVIEW_REQUEST_FILE } from "./circuitPlayback";

const workspace = vi.hoisted(() => ({ source: "" }));
function setup() {
  workspace.source = "export default () => null";
}

vi.mock(import("./projectFsMap"), () => ({
  loadProjectFsMap: async () => ({
    fsMap: { "index.tsx": workspace.source },
    hashedFiles: null,
    truncated: false,
  }),
  pickEntryFile: () => "index.tsx",
  readBuiltCircuitJson: async () => null,
}));
vi.mock(import("./viewerFrame"), () => ({
  viewerFrame: () => ({
    src: "about:blank",
    sandbox: "allow-scripts allow-same-origin",
    targetOrigin: "*",
  }),
}));

// Keep the dialog boundary observable without opening external report destinations.
vi.mock(import("./AutorouterReportDialog"), () => ({
  AutorouterReportDialog: (props) => (
    <output data-testid="routing-report">{props.phases.map((phase) => phase.id).join(",")}</output>
  ),
}));

const { openOrderPane } = vi.hoisted(() => ({ openOrderPane: vi.fn() }));
vi.mock(import("./orderActions"), async (importOriginal) => ({
  ...(await importOriginal()),
  openOrderPane,
}));

import CircuitPanel from "./CircuitPanel";

function Harness(props: ComponentProps<typeof CircuitPanel>) {
  const split = useRightPanelStore(
    (state) =>
      state.byThreadKey[scopedThreadKey(props.threadRef)]?.surfaces.some(
        (surface) => surface.kind === "circuit" && surface.split === true,
      ) ?? false,
  );
  return (
    <>
      <CircuitSplitControl threadRef={props.threadRef} split={split} />
      <CircuitPanel {...props} split={split} />
    </>
  );
}

function send(frame: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data }));
}
function ready(frame: HTMLIFrameElement) {
  send(frame, {
    runframe_type: "runframe_ready_to_receive",
    runframe_capabilities: ["show_header", "active_tab", "render_events"],
  });
}
function rendered(frame: HTMLIFrameElement) {
  send(frame, {
    runframe_type: "runframe_event",
    runframe_event: {
      type: "render_finished",
      circuit_json_element_counts: { pcb_board: 1, schematic_component: 1 },
    },
  });
}

const props = {
  environmentId: "test" as EnvironmentId,
  cwd: "/test",
  relativePath: "index.tsx",
  visible: true,
  workspaceMutationId: null,
  composerDraftTarget: {} as ComposerThreadTarget,
  threadRef: { environmentId: "test", threadId: "thread" } as ScopedThreadRef,
};

it("stacks at most two panes, isolates navigation/errors, and closes with focus retained", async () => {
  setup();
  useRightPanelStore.getState().open(props.threadRef, "circuit");
  // This isolated circuit panel has no route-dependent behavior.
  await using screen = await render(<Harness {...props} />, { router: false });
  await expect
    .element(screen.getByRole("button", { name: "Split circuit view", exact: true }))
    .toBeVisible();
  await vi.waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(1));
  const topFrame = document.querySelector("iframe")!;
  await act(() => ready(topFrame));
  await act(() => rendered(topFrame));
  await screen.getByRole("button", { name: "Split circuit view", exact: true }).click();
  await vi.waitFor(() => expect(document.querySelectorAll("iframe")).toHaveLength(2));
  await expect
    .element(screen.getByRole("button", { name: "Close split circuit view", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  expect(document.querySelectorAll('button[aria-label="Order"]')).toHaveLength(1);
  await screen.getByRole("button", { name: "Order", exact: true }).click();
  expect(openOrderPane).toHaveBeenCalledWith(props.threadRef);
  const bottomFrame = document.querySelectorAll("iframe")[1]!;
  await act(() => ready(bottomFrame));
  await act(() => rendered(bottomFrame));
  await act(() => {
    send(topFrame, {
      tscircuit_desktop_type: "autorouter_phases",
      phases: [{ id: "primary-route", status: "complete" }],
    });
    send(bottomFrame, {
      tscircuit_desktop_type: "autorouter_phases",
      phases: [{ id: "comparison-route", status: "complete" }],
    });
  });
  await vi.waitFor(() => {
    expect(document.querySelectorAll('[data-testid="routing-report"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="routing-report"]')?.textContent).toBe(
      "primary-route",
    );
  });
  await act(() =>
    send(bottomFrame, {
      runframe_type: "runframe_event",
      runframe_event: { type: "active_tab_changed", tab: "cad" },
    }),
  );
  const top = document.querySelector('[aria-label="Primary circuit view"]')!;
  const bottom = document.querySelector('[aria-label="Secondary circuit view"]')!;
  await vi.waitFor(() => {
    expect(top.textContent).not.toContain("1 error");
    expect(bottom.querySelector('[data-state="on"], [aria-pressed="true"]')?.textContent).toContain(
      "3D",
    );
  });
  await act(() =>
    send(bottomFrame, {
      runframe_type: "runframe_event",
      runframe_event: { type: "error", error_message: "Bottom failed" },
    }),
  );
  await vi.waitFor(() => {
    expect(bottom.textContent).toContain("1 error");
    expect(top.textContent).not.toContain("1 error");
  });
  await screen.getByRole("button", { name: "Close split circuit view", exact: true }).click();
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  expect(document.querySelector("iframe")).toBe(topFrame);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Split circuit view");
});

it("seeks one snapshot in both panes without resending live source", async () => {
  setup();
  // The panel reads its workspace props without route state.
  await using screen = await render(<CircuitPanel {...props} split />, { router: false });
  const frame = document.querySelector("iframe")!;
  using posted = vi.spyOn(frame.contentWindow!, "postMessage");
  await act(() => ready(frame));
  const previewId = () =>
    posted.mock.calls.findLast(([data]) => data?.runframe_props?.fsMap)?.[0].runframe_props.fsMap[
      PREVIEW_REQUEST_FILE
    ];
  await vi.waitFor(() => expect(previewId()).toBeTruthy());
  const originalPreview = previewId();
  const snapshot = '[{"type":"pcb_board","pcb_board_id":"original"}]';
  const emitPreview = (id: string, sequence: number, stage: string, circuitJsonText?: string) =>
    act(() =>
      send(frame, {
        tscircuit_desktop_type: "circuit_preview_event",
        event: { previewId: id, sequence, observedAt: sequence, stage, circuitJsonText },
      }),
    );
  await emitPreview(originalPreview, 0, "completed", snapshot);
  workspace.source = "export default () => <board />";
  await screen.rerender(<CircuitPanel {...props} split workspaceMutationId="edited" />);
  await vi.waitFor(() => expect(previewId()).not.toBe(originalPreview));
  await emitPreview(originalPreview, 1, "completed", "stale output");
  await emitPreview(previewId(), 0, "failed");
  await expect
    .element(screen.getByRole("slider", { name: "Design timeline" }))
    .toHaveAttribute("max", "2");
  const sourceMessages = posted.mock.calls.length;
  await screen.getByRole("button", { name: "Previous step" }).click();
  const history = document.querySelector('[aria-label="Historical design"]')!;
  expect(history.querySelector('[aria-label="Order"]')).toBeNull();
  for (const historicalFrame of history.querySelectorAll("iframe")) {
    using received = vi.spyOn(historicalFrame.contentWindow!, "postMessage");
    await act(() => ready(historicalFrame));
    await vi.waitFor(() =>
      expect(received.mock.lastCall?.[0]?.runframe_props).toMatchObject({
        mainComponentPath: "playback.circuit.json",
        fsMap: { "playback.circuit.json": snapshot },
      }),
    );
  }
  await screen.getByRole("button", { name: "Back to live" }).click();
  expect(posted.mock.calls).toHaveLength(sourceMessages);
  await screen.rerender(<CircuitPanel {...props} cwd="/another-workspace" />);
  await expect
    .element(screen.getByRole("group", { name: "Design playback" }))
    .not.toBeInTheDocument();
});
