// @effect-diagnostics globalFetch:off -- Exercises the real native loopback HTTP callback without any external service.
import { describe, expect, it } from "vite-plus/test";
import { startLogin } from "./login.ts";

const token = `header.${Buffer.from(JSON.stringify({ name: "Board designer", exp: 40_000_000_000 })).toString("base64url")}.signature`;

describe("CircuitHub browser callback", () => {
  it("accepts a valid session only on the unpredictable loopback callback and never echoes credentials", async () => {
    const session = await startLogin();
    try {
      const redirect = new URL(session.url).searchParams.get("redirect_uri")!;
      const callback = new URL(redirect);
      expect(callback.hostname).toBe("127.0.0.1");
      expect((await fetch(new URL("/wrong-path?token=ignored", callback))).status).toBe(404);
      expect((await fetch(callback)).status).toBe(400);
      callback.searchParams.set("token", token);
      const response = await fetch(callback);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain(token);
      expect(await session.token).toBe(token);
      expect((await fetch(callback)).status).toBe(404);
    } finally {
      session.close();
    }
  });

  it("cancels the listener and rejects an unfinished sign-in", async () => {
    const session = await startLogin();
    session.close();
    await expect(session.token).rejects.toThrow("cancelled");
  });
});
