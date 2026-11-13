import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ProjectScript } from "../project.ts";
import { ServerSettings } from "../settings.ts";
import {
  TSCIRCUIT_DEFAULT_PROJECT_SCRIPTS,
  TSCIRCUIT_PREVIEW_PORT,
} from "./defaultProjectScripts.ts";

const decodeSettings = Schema.decodeUnknownSync(ServerSettings);

describe("tscircuit default project actions", () => {
  it("gives a fresh install the Circuit preview action", () => {
    const [preview] = decodeSettings({}).defaultProjectScripts;

    expect(preview?.name).toBe("Circuit preview");
    expect(preview?.command).toContain(`--port ${TSCIRCUIT_PREVIEW_PORT}`);
    expect(preview?.previewUrl).toBe(`http://localhost:${TSCIRCUIT_PREVIEW_PORT}`);
    expect(preview?.autoOpenPreview).toBe(true);
  });

  it("keeps a list the user saved, including an empty one", () => {
    expect(decodeSettings({ defaultProjectScripts: [] }).defaultProjectScripts).toEqual([]);
  });

  it("only ships actions the project action schema accepts", () => {
    const decodeScripts = Schema.decodeUnknownSync(Schema.Array(ProjectScript));
    expect(decodeScripts(TSCIRCUIT_DEFAULT_PROJECT_SCRIPTS)).toEqual(
      TSCIRCUIT_DEFAULT_PROJECT_SCRIPTS,
    );
  });
});
