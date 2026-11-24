import { expect, it } from "vite-plus/test";
import { CircuitHubHttpError, createApi } from "./api.ts";

const TOKEN = "unit-test-bearer-secret";
it.each([false, true])(
  "reports the rejected operation and validation reason without credentials (nested=%s)",
  async (nested) => {
    const message = `Unsupported design format. Bearer ${TOKEN}; see https://storage.example/upload?sig=private`;
    const body = nested
      ? { error: { message, code: "VALIDATION_ERROR" } }
      : { error: message, code: "VALIDATION_ERROR" };
    const api = createApi(TOKEN, new AbortController().signal, async () =>
      Response.json(body, { status: 400 }),
    );
    const error = await api
      .create({ name: "board", workspace: "team", exportClassification: "EAR99", files: [] })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(CircuitHubHttpError);
    expect(String(error)).toContain("POST /projects");
    expect(String(error)).toContain("HTTP 400");
    expect(String(error)).toContain("VALIDATION_ERROR");
    expect(String(error)).toContain("Unsupported design format");
    expect(JSON.stringify(error)).not.toContain(TOKEN);
    expect(String(error)).not.toContain(TOKEN);
    expect(String(error)).not.toContain("sig=private");
  },
);

it("never echoes non-JSON error pages", async () => {
  const api = createApi(
    TOKEN,
    new AbortController().signal,
    async () => new Response(`<html>${TOKEN}</html>`, { status: 400 }),
  );
  const error = await api.board(1).catch((cause: unknown) => cause);
  expect(String(error)).toContain("GET /revisions/1/board");
  expect(String(error)).not.toContain(TOKEN);
  expect(String(error)).not.toContain("<html>");
});

it.each([
  { input: "EAR99", declaration: { tag: "EAR99" } },
  { input: "NotExportControlled", declaration: { tag: "NotExportControlled" } },
  { input: "3A001.a", declaration: { tag: "ECCN", contents: "3A001.a" } },
])(
  "creates a project using CircuitHub's tagged export declaration: $input",
  async ({ input, declaration }) => {
    const api = createApi(TOKEN, new AbortController().signal, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (JSON.stringify(body.exportClassification) !== JSON.stringify(declaration))
        return new Response(
          "Error in $.exportClassification: expected an Object, encountered String",
          { status: 400, headers: { "Content-Type": "text/plain;charset=utf-8" } },
        );
      return Response.json({ projectId: 12, revisionId: 24 });
    });
    await expect(
      api.create({
        name: "board",
        workspace: "team",
        exportClassification: input,
        files: [{ filename: "board.kicad_pcb", objectKey: "uploaded/board.kicad_pcb" }],
      }),
    ).resolves.toEqual({ projectId: 12, revisionId: 24 });
  },
);

it.each([
  { status: 400, contentType: "text/plain;charset=utf-8", visible: true },
  { status: 401, contentType: "text/plain", visible: false },
  { status: 500, contentType: "text/plain", visible: false },
  { status: 400, contentType: "text/html", visible: false },
])(
  "shows safe plain-text validation only for client errors: $status $contentType",
  async ({ status, contentType, visible }) => {
    const api = createApi(
      TOKEN,
      new AbortController().signal,
      async () =>
        new Response(
          `Error in $.exportClassification: expected an Object, encountered String. Bearer ${TOKEN} https://storage.example/?sig=secret`,
          { status, headers: { "Content-Type": contentType } },
        ),
    );
    const error = await api.board(1).catch((cause: unknown) => cause);
    expect(String(error).includes("expected an Object")).toBe(visible);
    expect(String(error)).not.toContain(TOKEN);
    expect(String(error)).not.toContain("sig=secret");
  },
);
