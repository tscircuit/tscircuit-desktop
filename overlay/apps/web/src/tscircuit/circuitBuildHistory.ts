import type { ElementCounts } from "./circuitViews";

export interface CircuitBuildVersion {
  readonly id: number;
  readonly circuitJsonText: string;
  readonly counts: ElementCounts;
  readonly files: { readonly fsMap: Record<string, string>; readonly mainComponentPath: string };
}

/** Keep completed output, so revisiting a version never evaluates or routes its sources again. */
export function completedCircuit(text: string): Omit<CircuitBuildVersion, "id"> | null {
  let elements: unknown;
  try {
    elements = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(elements) || elements.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const element of elements) {
    if (typeof element !== "object" || element === null || typeof element.type !== "string") return null;
    if (element.type.includes("error")) return null;
    counts[element.type] = (counts[element.type] ?? 0) + 1;
  }
  // Metadata alone is not a built circuit.
  if (!Object.keys(counts).some((type) => type.startsWith("pcb_") || type.startsWith("schematic_") || type === "system_block_page" || type === "simulation_experiment")) return null;
  const circuitJsonText = JSON.stringify(elements);
  const path = "completed.circuit.json";
  return { circuitJsonText, counts, files: { fsMap: { [path]: circuitJsonText }, mainComponentPath: path } };
}

export function appendCircuitBuild(
  versions: ReadonlyArray<CircuitBuildVersion>,
  text: string,
): ReadonlyArray<CircuitBuildVersion> {
  const completed = completedCircuit(text);
  if (completed === null || versions.at(-1)?.circuitJsonText === completed.circuitJsonText) return versions;
  return [...versions, { ...completed, id: (versions.at(-1)?.id ?? 0) + 1 }].slice(-10);
}

/** Environment and workspace are both needed: files with the same name can hold different boards. */
export const circuitBuildKey = (environment: string, cwd: string, file: string): string =>
  JSON.stringify([environment, cwd, file]);
