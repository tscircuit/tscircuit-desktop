import { type EnvironmentId, type ScopedThreadRef } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import type { ComposerThreadTarget } from "~/composerDraftStore";
import { act, render } from "../../test/render";
import CircuitPanel from "./CircuitPanel";
import { PLAYBACK_REQUEST_FILE } from "./circuitPlayback";

const workspace = vi.hoisted(() => ({ source: "export default () => null" }));
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

const props = {
  environmentId: "playback-test" as EnvironmentId,
  cwd: "/playback-test",
  relativePath: "index.tsx",
  visible: true,
  workspaceMutationId: "one",
  composerDraftTarget: {} as ComposerThreadTarget,
  threadRef: { environmentId: "playback-test", threadId: "thread" } as ScopedThreadRef,
};
function message(frame: HTMLIFrameElement, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data }));
}
function ready(frame: HTMLIFrameElement) {
  message(frame, {
    runframe_type: "runframe_ready_to_receive",
    runframe_capabilities: ["show_header", "active_tab", "render_events"],
  });
}
const json = (id: string) =>
  JSON.stringify([
    { type: "pcb_board", pcb_board_id: id },
    { type: "schematic_component", schematic_component_id: id },
  ]);

it("keeps live sources independent of seeking, synchronizes split snapshots and rejects stale runs", async () => {
  await using screen = await render(<CircuitPanel {...props} split />, { router: false });
  const live = document.querySelectorAll("iframe");
  const posted = vi.spyOn(live[0]!.contentWindow!, "postMessage");
  await act(() => {
    ready(live[0]!);
    ready(live[1]!);
  });
  await vi.waitFor(() =>
    expect(posted.mock.lastCall?.[0]?.runframe_props?.fsMap?.[PLAYBACK_REQUEST_FILE]).toBeTruthy(),
  );
  const request = () =>
    posted.mock.calls.findLast(([data]) => data?.runframe_props?.fsMap)?.[0].runframe_props.fsMap[
      PLAYBACK_REQUEST_FILE
    ] as string;
  const firstRequest = request();
  const observe = (requestId: string, sequence: number, stage: string, circuitJsonText?: string) =>
    act(() =>
      message(live[0]!, {
        tscircuit_desktop_type: "playback_observation",
        observation: { requestId, sequence, at: sequence * 1000, stage, circuitJsonText },
      }),
    );
  await observe(firstRequest, 0, "completed", json("first"));
  workspace.source = "export default () => <board />";
  await screen.rerender(<CircuitPanel {...props} split workspaceMutationId="two" />);
  await vi.waitFor(() => expect(request()).not.toBe(firstRequest));
  const secondRequest = request();
  await observe(firstRequest, 1, "completed", json("stale"));
  await observe(secondRequest, 0, "failed");
  const timeline = screen.getByRole("slider", { name: "Design timeline" });
  await expect.element(timeline).toHaveAttribute("max", "2");
  const liveCalls = posted.mock.calls.length;
  await screen.getByRole("button", { name: "Previous step" }).click();
  await expect
    .element(
      screen.getByText("No new snapshot at this step · showing the preceding retained snapshot"),
    )
    .toBeVisible();
  expect(
    document.querySelector<HTMLButtonElement>('button[aria-label="Order"]')?.checkVisibility(),
  ).toBe(false);
  const historyFrames = [...document.querySelectorAll('[aria-label="Historical design"] iframe')];
  const historyPosts = historyFrames.map((frame) =>
    vi.spyOn((frame as HTMLIFrameElement).contentWindow!, "postMessage"),
  );
  await act(() => historyFrames.forEach((frame) => ready(frame as HTMLIFrameElement)));
  for (const spy of historyPosts)
    await vi.waitFor(() =>
      expect(spy.mock.lastCall?.[0]?.runframe_props).toMatchObject({
        mainComponentPath: "playback.circuit.json",
        fsMap: { "playback.circuit.json": json("first") },
      }),
    );
  await screen.getByRole("button", { name: "Previous step" }).click();
  await expect.element(screen.getByText("Historical snapshot · read-only")).toBeVisible();
  await screen.getByRole("button", { name: "Back to live" }).click();
  expect(posted.mock.calls).toHaveLength(liveCalls);
  await screen.rerender(<CircuitPanel {...props} cwd="/different-workspace" />);
  await expect
    .element(screen.getByRole("group", { name: "Design playback" }))
    .not.toBeInTheDocument();
});
