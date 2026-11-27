import JSZip from "jszip";
import { describe, expect, it } from "vite-plus/test";

import {
  countBuildElements,
  ORDER_FILES,
  orderFileNeedsMet,
  orderProjectName,
  packOrderFiles,
  readOrderFiles,
} from "../../src/tscircuit/orderFiles";

describe("orderFileNeedsMet", () => {
  it("needs a board for the board's files and placed parts for the assembly files", () => {
    expect([...orderFileNeedsMet({ pcb_board: 1, pcb_component: 2 })]).toEqual(["board", "parts"]);
    expect([...orderFileNeedsMet({ pcb_panel: 1 })]).toEqual(["board"]);
    expect([...orderFileNeedsMet({ pcb_component: 2, pcb_smtpad: 4 })]).toEqual(["parts"]);
    expect([...orderFileNeedsMet({ source_component: 2, schematic_component: 2 })]).toEqual([]);
  });
});

describe("countBuildElements", () => {
  it("counts a build's elements by type, as the viewer does for a run", () => {
    const build = JSON.stringify([
      { type: "pcb_board" },
      { type: "pcb_component" },
      { type: "pcb_component" },
      { type: "source_project_metadata" },
      "not an element",
    ]);
    expect(countBuildElements(build)).toEqual({
      pcb_board: 1,
      pcb_component: 2,
      source_project_metadata: 1,
    });
  });

  it("has no counts for a file that is not Circuit JSON", () => {
    expect(countBuildElements("{")).toBeNull();
    expect(countBuildElements('{"type":"pcb_board"}')).toBeNull();
  });
});

describe("orderProjectName", () => {
  it("names files after the file ordered, or the project folder when the file is just the entry", () => {
    expect(orderProjectName("boards/motor-driver.circuit.tsx", "/home/me/robot")).toBe(
      "motor-driver",
    );
    expect(orderProjectName("led.tsx", "/home/me/robot")).toBe("led");
    expect(orderProjectName("index.tsx", "/home/me/robot/")).toBe("robot");
    expect(orderProjectName("src\\main.tsx", "C:\\Users\\me\\My Board")).toBe("My-Board");
    expect(orderProjectName("my board (v2).tsx", "/")).toBe("my-board-v2");
    expect(orderProjectName("index.tsx", "/")).toBe("index");
  });
});

describe("readOrderFiles", () => {
  it("reads the files of the viewer's answer", () => {
    const files = { "F_Cu.gbr": "G04*", "drill/plated.drl": "M48" };
    expect(readOrderFiles({ files })).toEqual(files);
  });

  it("refuses files it could not save safely", () => {
    for (const files of [
      {},
      undefined,
      ["F_Cu.gbr"],
      { "F_Cu.gbr": 1 },
      { "../../.zshrc": "x" },
      { "/etc/hosts": "x" },
      { "gerber\\..\\x": "x" },
      { "a//b": "x" },
      { "": "x" },
    ]) {
      expect(readOrderFiles({ files })).toBeNull();
    }
  });
});

describe("packOrderFiles", () => {
  const fileOf = (kind: string) => {
    const file = ORDER_FILES.find((entry) => entry.kind === kind);
    if (file === undefined) throw new Error(`No order file of kind ${kind}`);
    return file;
  };

  it("zips every Gerber, at the paths the viewer gave", async () => {
    const contents = { "F_Cu.gbr": "G04 copper*", "Edge_Cuts.gbr": "G04 outline*" };
    const blob = await packOrderFiles(fileOf("gerbers"), contents);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).toSorted()).toEqual(["Edge_Cuts.gbr", "F_Cu.gbr"]);
    expect(await zip.file("F_Cu.gbr")?.async("string")).toBe("G04 copper*");
  });

  it("saves a CSV as the CSV itself", async () => {
    const blob = await packOrderFiles(fileOf("bom"), { "bom.csv": "Designator,Value\nR1,1k\n" });
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(await blob.text()).toBe("Designator,Value\nR1,1k\n");
  });
});
