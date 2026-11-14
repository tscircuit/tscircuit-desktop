/** How the Circuit tab frames the app's copy of RunFrame (public/tscircuit-viewer/frame.html). */
export interface ViewerFrame {
  readonly src: string;
  readonly sandbox: string;
  /** The origin to post the project's files to. */
  readonly targetOrigin: string;
}

/** The host the desktop app answers the viewer's files on (apps/desktop/src/tscircuit/circuitViewerHost.ts). */
const DESKTOP_VIEWER_HOST = "viewer";

/**
 * The viewer runs the project's code, so it must not share the app's origin.
 * The desktop app serves it on a host of its own. A browser has only the one
 * origin, so there the sandbox takes the frame's origin away instead, at a
 * cost: without an origin its workers get no WebGPU, which the PCB view draws with.
 */
export function viewerFrame(input: {
  readonly desktop: boolean;
  /** The app page's own protocol, such as "tscircuit-desktop:". */
  readonly protocol: string;
  readonly baseUrl: string;
}): ViewerFrame {
  if (input.desktop) {
    const origin = `${input.protocol}//${DESKTOP_VIEWER_HOST}`;
    return {
      src: `${origin}/frame.html`,
      sandbox: "allow-scripts allow-same-origin",
      targetOrigin: origin,
    };
  }
  return {
    src: `${input.baseUrl}tscircuit-viewer/frame.html`,
    sandbox: "allow-scripts",
    // An origin of "null" cannot be named as a target. The frame's content is the app's own page.
    targetOrigin: "*",
  };
}
