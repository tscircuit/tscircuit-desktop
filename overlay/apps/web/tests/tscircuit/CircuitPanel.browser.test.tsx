import type { ComponentProps } from "react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "~/rightPanelStore";
import { CircuitSplitControl } from "../../src/tscircuit/CircuitSplitControl";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../test/render";
import type { ComposerThreadTarget } from "~/composerDraftStore";
import type { SavedCircuitBuild } from "../../src/tscircuit/savedCircuitBuild";

const workspace = vi.hoisted(() => ({
  source: "",
  truncated: false,
  builds: [] as SavedCircuitBuild[],
  read: async (_path: string): Promise<string | null> => null,
}));
function setup() {
  workspace.source = "export default () => null";
  workspace.truncated = false;
  workspace.builds = [];
  workspace.read = async () => null;
}

vi.mock(import("../../src/tscircuit/projectFsMap"), () => ({
  loadProjectFsMap: async () => ({
    fsMap: { "index.tsx": workspace.source },
    hashedFiles: null,
    truncated: workspace.truncated,
  }),
  pickEntryFile: () => "index.tsx",
  readBuiltCircuitJson: async (_env: unknown, _cwd: string, path: string) => workspace.read(path),
}));
vi.mock(import("../../src/tscircuit/circuitBuildHistory"), () => ({
  loadCircuitBuildHistory: async (_env: unknown, cwd: string) =>
    cwd === "/test" ? workspace.builds : [],
}));
vi.mock(import("../../src/tscircuit/viewerFrame"), () => ({
  viewerFrame: () => ({
    src: "about:blank",
    sandbox: "allow-scripts allow-same-origin",
    targetOrigin: "*",
  }),
}));

// Keep the dialog boundary observable without opening external report destinations.
vi.mock(import("../../src/tscircuit/AutorouterReportDialog"), () => ({
  AutorouterReportDialog: (props) => (
    <output data-testid="routing-report">{props.phases.map((phase) => phase.id).join(",")}</output>
  ),
}));

const { openOrderPane } = vi.hoisted(() => ({ openOrderPane: vi.fn() }));
vi.mock(import("../../src/tscircuit/orderActions"), async (importOriginal) => ({
  ...(await importOriginal()),
  openOrderPane,
}));

import CircuitPanel from "../../src/tscircuit/CircuitPanel";

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

it("opens saved builds in both panes without rerunning live source or accepting a late read", async () => {
  setup();
  workspace.truncated = true;
  const build = (id: string): SavedCircuitBuild => ({
    id: `archive:${id}`,
    at: 1,
    label: "Saved build",
    path: id,
  });
  workspace.builds = [build("older"), build("newer")];
  let finishOld!: (text: string) => void;
  const snapshot =
    '[{"type":"pcb_board","pcb_board_id":"saved"},{"type":"source_project_metadata","source_filesystem_md5_hash":"old-source"}]';
  workspace.read = (path) =>
    path === "older"
      ? new Promise((resolve) => {
          finishOld = resolve;
        })
      : Promise.resolve(snapshot);
  // The panel reads its workspace props without route state.
  await using screen = await render(<CircuitPanel {...props} split />, { router: false });
  const live = document.querySelector("iframe")!;
  using posted = vi.spyOn(live.contentWindow!, "postMessage");
  await act(() => ready(live));
  await vi.waitFor(() =>
    expect(document.querySelector('option[value="archive:older"]')).not.toBeNull(),
  );
  await screen.getByRole("combobox", { name: "Saved build" }).selectOptions("archive:older");
  await expect.element(screen.getByText("Loading saved build…", { exact: true })).toBeVisible();
  await screen.getByRole("combobox", { name: "Saved build" }).selectOptions("archive:newer");
  const historyFrames = () =>
    document.querySelectorAll<HTMLIFrameElement>('[aria-label="Historical design"] iframe');
  await vi.waitFor(() => expect(historyFrames()).toHaveLength(2));
  const first = historyFrames()[0]!;
  const second = historyFrames()[1]!;
  using firstPosts = vi.spyOn(first.contentWindow!, "postMessage");
  using secondPosts = vi.spyOn(second.contentWindow!, "postMessage");
  for (const [frame, sent] of [
    [first, firstPosts],
    [second, secondPosts],
  ] as const) {
    await act(() => ready(frame));
    await vi.waitFor(() =>
      expect(sent.mock.lastCall?.[0]?.runframe_props).toMatchObject({
        mainComponentPath: "playback.circuit.json",
        fsMap: { "playback.circuit.json": snapshot },
      }),
    );
  }
  await act(async () => {
    finishOld('[{"type":"pcb_board","pcb_board_id":"late"}]');
    await Promise.resolve();
  });
  expect(firstPosts.mock.lastCall?.[0]?.runframe_props.fsMap["playback.circuit.json"]).toBe(
    snapshot,
  );
  const count = posted.mock.calls.length;
  expect(
    document.querySelector('[aria-label="Historical design"] [aria-label="Order"]'),
  ).toBeNull();
  await expect
    .element(screen.getByRole("combobox", { name: "Saved build" }))
    .toHaveValue("archive:newer");
  expect(historyFrames()[0]?.isConnected).toBe(true);
  await screen.getByRole("button", { name: "Back to live" }).click();
  expect(posted.mock.calls).toHaveLength(count);
  await screen.rerender(<CircuitPanel {...props} cwd="/another-workspace" />);
  await expect
    .element(screen.getByRole("group", { name: "Build history" }))
    .not.toBeInTheDocument();
});
