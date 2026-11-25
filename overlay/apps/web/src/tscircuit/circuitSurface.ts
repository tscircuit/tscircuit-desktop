import type { ThreadRightPanelState } from "../rightPanelStore";

/** tscircuit desktop: the right-panel tab that renders a tscircuit file with RunFrame. */
export interface CircuitSurface {
  id: "circuit";
  kind: "circuit";
  /** Workspace-relative file to render. Unset renders the project's entry file. */
  relativePath?: string;
  /** One optional comparison pane below the primary circuit view. */
  split?: boolean;
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

/** The file of the panel's Circuit tab: undefined when it shows the entry file, null with no such tab. */
export function circuitTabFile(panel: ThreadRightPanelState): string | undefined | null {
  const tab = panel.surfaces.find((surface) => surface.kind === "circuit");
  return tab === undefined ? null : tab.relativePath;
}

export const isCircuitJsonPath = (path: string): boolean =>
  /(^|[\\/])(?:[^\\/]*\.)?circuit\.json$/i.test(path);

const isCircuitSourcePath = (path: string): boolean =>
  /\.tsx$/i.test(path) || isCircuitJsonPath(path);

/**
 * Opening a .tsx or Circuit JSON shows it in the Circuit tab. Returns null to fall through to
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
