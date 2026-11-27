import type { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../test/render";

const { readBuiltCircuitJson } = vi.hoisted(() => ({ readBuiltCircuitJson: vi.fn() }));
vi.mock(import("../../src/tscircuit/projectFsMap"), async (importOriginal) => ({
  ...(await importOriginal()),
  readBuiltCircuitJson,
}));

import { useBuiltCircuit } from "../../src/tscircuit/CircuitPanel";

function Result(props: { hash: string | null; revision: string | null }) {
  const result = useBuiltCircuit({
    environmentId: "test" as EnvironmentId,
    cwd: "/test",
    visible: true,
    workspaceMutationId: props.revision,
    build: { path: "dist/startup/circuit.json", sourceHash: props.hash },
  });
  return <output data-testid="result">{JSON.stringify(result)}</output>;
}

it("reads an explicitly selected result and refreshes it on focus and workspace edits", async () => {
  readBuiltCircuitJson
    .mockReset()
    .mockResolvedValue('[{"type":"simulation_transient_voltage_graph"}]');
  // The file read hook has no route-dependent behavior.
  await using screen = await render(<Result hash={null} revision={null} />, { router: false });
  await vi.waitFor(() =>
    expect(document.querySelector("output")?.textContent).toContain('"status":"current"'),
  );
  await vi.waitFor(() =>
    expect(document.querySelector("output")?.textContent).toContain(
      "simulation_transient_voltage_graph",
    ),
  );

  readBuiltCircuitJson.mockResolvedValue('[{"type":"simulation_transient_current_graph"}]');
  await act(() => window.dispatchEvent(new Event("focus")));
  await vi.waitFor(() =>
    expect(document.querySelector("output")?.textContent).toContain(
      "simulation_transient_current_graph",
    ),
  );

  readBuiltCircuitJson.mockResolvedValue(
    '[{"type":"simulation_transient_voltage_graph","name":"updated"}]',
  );
  await screen.rerender(<Result hash={null} revision="new-build" />);
  await vi.waitFor(() =>
    expect(document.querySelector("output")?.textContent).toContain("updated"),
  );
});

it("continues rejecting a stale result when previewing its source", async () => {
  readBuiltCircuitJson
    .mockReset()
    .mockResolvedValue('[{"type":"source_project_metadata","source_filesystem_md5_hash":"old"}]');
  // The file read hook has no route-dependent behavior.
  await using _screen = await render(<Result hash="changed" revision={null} />, { router: false });
  await vi.waitFor(() =>
    expect(document.querySelector("output")?.textContent).toContain('"status":"none"'),
  );
});
