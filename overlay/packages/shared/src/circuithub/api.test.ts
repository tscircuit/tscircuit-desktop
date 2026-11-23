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
