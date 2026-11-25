import { describe, expect, it } from "vite-plus/test";

import type { ThreadRightPanelState } from "../../src/rightPanelStore";
import {
  circuitSurface,
  circuitTabTitle,
  openTsxInCircuitTab,
} from "../../src/tscircuit/circuitSurface";
import { expectedBuild, isBuildOfSources } from "../../src/tscircuit/builtCircuit";

const closedPanel: ThreadRightPanelState = { isOpen: false, activeSurfaceId: null, surfaces: [] };

describe("openTsxInCircuitTab", () => {
  it("opens a .tsx file in the Circuit tab and shows the panel", () => {
    expect(openTsxInCircuitTab(closedPanel, "boards/led.tsx", undefined)).toEqual({
      isOpen: true,
      activeSurfaceId: "circuit",
      surfaces: [{ id: "circuit", kind: "circuit", relativePath: "boards/led.tsx" }],
    });
  });

  it("switches the file of the Circuit tab that is already open, keeping tab order", () => {
    const withTabs: ThreadRightPanelState = {
      isOpen: true,
      activeSurfaceId: "diff",
      surfaces: [circuitSurface("index.tsx"), { id: "diff", kind: "diff" }],
    };

    const next = openTsxInCircuitTab(withTabs, "boards/led.tsx", undefined);

    expect(next?.activeSurfaceId).toBe("circuit");
    expect(next?.surfaces).toEqual([
      { id: "circuit", kind: "circuit", relativePath: "boards/led.tsx" },
      { id: "diff", kind: "diff" },
    ]);
  });

  it("leaves other files, and opens at a line, to the source viewer", () => {
    expect(openTsxInCircuitTab(closedPanel, "README.md", undefined)).toBeNull();
    expect(openTsxInCircuitTab(closedPanel, "lib/math.ts", undefined)).toBeNull();
    expect(openTsxInCircuitTab(closedPanel, "index.tsx", 12)).toBeNull();
  });
});

describe("circuitTabTitle", () => {
  it("names the tab after the file it shows", () => {
    expect(circuitTabTitle(circuitSurface("boards/led.tsx"))).toBe("led.tsx");
    expect(circuitTabTitle(circuitSurface("index.tsx"))).toBe("index.tsx");
  });

  it("is plain Circuit until a file has been picked", () => {
    expect(circuitTabTitle(circuitSurface())).toBe("Circuit");
  });
});

it("cannot open completed simulation results after a report edit invalidates the build", () => {
  const files = {
    "index.circuit.tsx": "export default () => <board />",
    "README.md": "Simulation pending",
  };
  const build = expectedBuild("index.circuit.tsx", files)!;
  const circuitJson = JSON.stringify([
    { type: "source_project_metadata", source_filesystem_md5_hash: build.sourceHash },
    {
      type: "simulation_transient_voltage_graph",
      simulation_transient_voltage_graph_id: "graph_0",
      timestamps: [0, 0.001],
      voltage_levels: [0, 3.3],
    },
  ]);
  const afterReport = expectedBuild("index.circuit.tsx", {
    ...files,
    "README.md": "Simulation complete: 3.3 V",
  })!;

  expect({
    sourceBuildIsCurrent: isBuildOfSources(circuitJson, afterReport.sourceHash),
    openedResult: openTsxInCircuitTab(closedPanel, build.path, undefined),
  }).toMatchInlineSnapshot(`
    {
      "openedResult": null,
      "sourceBuildIsCurrent": false,
    }
  `);
});
