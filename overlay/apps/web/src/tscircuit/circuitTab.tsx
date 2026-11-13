import { CircuitBoard } from "lucide-react";

export function CircuitTabIcon() {
  return <CircuitBoard className="size-3 shrink-0" />;
}

/**
 * The "Circuit" entry for the right panel's add-tab menus. Returns nothing
 * where the panel has no thread to open a circuit for.
 */
export function circuitSurfaceActions(onAddCircuit: (() => void) | undefined) {
  if (!onAddCircuit) return [];
  return [
    {
      label: "Circuit",
      description: "Preview the project's tscircuit board.",
      icon: CircuitBoard,
      shortcut: "C",
      available: true,
      disabledReason: "",
      onClick: onAddCircuit,
    },
  ];
}
