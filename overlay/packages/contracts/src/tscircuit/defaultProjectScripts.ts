import type { ProjectScript } from "../project.ts";

/**
 * tscircuit desktop: the project actions a fresh install starts with (upstream
 * starts with none). "Circuit preview" runs `tsci dev` and opens it in the
 * in-app browser. A list the user saved in Settings always wins over this one.
 */
export const TSCIRCUIT_PREVIEW_PORT = 3020;

export const TSCIRCUIT_DEFAULT_PROJECT_SCRIPTS: ReadonlyArray<ProjectScript> = [
  {
    id: "tscircuit-preview",
    name: "Circuit preview",
    // The tscircuit CLI runs on Bun, so `bunx` is always available where it works.
    command: `bunx tscircuit dev --port ${TSCIRCUIT_PREVIEW_PORT}`,
    icon: "play",
    runOnWorktreeCreate: false,
    previewUrl: `http://localhost:${TSCIRCUIT_PREVIEW_PORT}`,
    autoOpenPreview: true,
  },
];
