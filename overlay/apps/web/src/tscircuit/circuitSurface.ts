import type { ThreadRightPanelState } from "../rightPanelStore";

/** tscircuit desktop: the right-panel tab that renders a tscircuit file with RunFrame. */
export interface CircuitSurface {
  id: "circuit";
  kind: "circuit";
  /** Workspace-relative file to render. Unset renders the project's entry file. */
  relativePath?: string;
}

export const circuitSurface = (relativePath?: string): CircuitSurface =>
  relativePath === undefined
    ? { id: "circuit", kind: "circuit" }
    : { id: "circuit", kind: "circuit", relativePath };

/** The tab is named after the file it shows, like a file tab, once one has been picked. */
export const circuitTabTitle = (surface: CircuitSurface): string =>
  surface.relativePath === undefined
    ? "Circuit"
    : surface.relativePath.slice(
        Math.max(surface.relativePath.lastIndexOf("/"), surface.relativePath.lastIndexOf("\\")) + 1,
      );

const isCircuitSourcePath = (path: string): boolean => /\.tsx$/i.test(path);

/**
 * Opening a .tsx shows it in the Circuit tab. Returns null to fall through to
 * the source viewer: other file types, and opens that ask for a line.
 */
export function openTsxInCircuitTab(
  current: ThreadRightPanelState,
  requestedPath: string,
  line: number | undefined,
): ThreadRightPanelState | null {
  if (line !== undefined || !isCircuitSourcePath(requestedPath)) return null;
  const surface = circuitSurface(requestedPath);
  const alreadyOpen = current.surfaces.some((entry) => entry.kind === "circuit");
  return {
    ...current,
    isOpen: true,
    activeSurfaceId: surface.id,
    surfaces: alreadyOpen
      ? current.surfaces.map((entry) => (entry.kind === "circuit" ? surface : entry))
      : [...current.surfaces, surface],
  };
}
