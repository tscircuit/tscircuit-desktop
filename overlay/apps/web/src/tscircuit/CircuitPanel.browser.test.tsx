import type { ComponentProps } from "react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "~/rightPanelStore";
import { CircuitSplitControl } from "./CircuitSplitControl";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../test/render";
import type { ComposerThreadTarget } from "~/composerDraftStore";

vi.mock(import("./projectFsMap"), () => ({
  loadProjectFsMap: async () => ({
    fsMap: { "index.tsx": "export default () => null" },
    hashedFiles: null,
    truncated: false,
  }),
  pickEntryFile: () => "index.tsx",
  readBuiltCircuitJson: async () => null,
}));
vi.mock(import("./viewerFrame"), () => ({
  viewerFrame: () => ({ src: "about:blank", sandbox: "allow-scripts", targetOrigin: "*" }),
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

it("stacks at most two panes, isolates navigation/errors, and closes with focus retained", async () => {
  const props = {
    environmentId: "test" as EnvironmentId,
    cwd: "/test",
    relativePath: "index.tsx",
    visible: true,
    workspaceMutationId: null,
    composerDraftTarget: {} as ComposerThreadTarget,
    threadRef: { environmentId: "test", threadId: "thread" } as ScopedThreadRef,
  };
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
  const panel = document.querySelector("[data-circuit-panel]")!;
  expect(panel.classList.contains("flex-col")).toBe(true);
  expect(panel.classList.contains("divide-y")).toBe(true);
  expect(panel.querySelector("section")?.getAttribute("aria-label")).toBe("Primary circuit view");
  expect(panel.querySelectorAll("section")[1]?.getAttribute("aria-label")).toBe(
    "Secondary circuit view",
  );
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
  await screen.rerender(<Harness {...props} cwd={undefined} />);
  await screen.getByRole("button", { name: "Close split circuit view", exact: true }).click();
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  expect(document.querySelector("iframe")).not.toBe(topFrame);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Split circuit view");
});
