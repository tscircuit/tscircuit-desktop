import { create } from "zustand";

import { appendCircuitBuild, type CircuitBuildVersion } from "./circuitBuildHistory";

export const EMPTY_CIRCUIT_BUILDS: ReadonlyArray<CircuitBuildVersion> = [];

export const useCircuitBuildStore = create<{
  readonly byCircuit: Readonly<Record<string, ReadonlyArray<CircuitBuildVersion>>>;
}>(() => ({ byCircuit: {} }));

/** Session history survives closing and reopening the Circuit tab. */
export function rememberCircuitBuild(key: string, text: string): void {
  useCircuitBuildStore.setState((state) => {
    const current = state.byCircuit[key] ?? EMPTY_CIRCUIT_BUILDS;
    const versions = appendCircuitBuild(current, text);
    if (versions === current) return state;
    return { byCircuit: { ...state.byCircuit, [key]: versions } };
  });
}
