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
      expect(callback.hostname).toBe("localhost");
      expect(new URL(session.url).origin).toBe("https://app.circuithub.com");
      expect(new URL(session.url).pathname).toBe("/platform/v1/auth/cli");
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

it("accepts the CLI cloud fallback only for the active callback and an unexpired JWT", async () => {
  const session = await startLogin();
  try {
    const callback = new URL(new URL(session.url).searchParams.get("redirect_uri")!);
    callback.searchParams.set("token", token);
    const wrong = new URL(callback);
    wrong.pathname += "-wrong";
    expect(session.acceptCallback(wrong.href)).toBe(false);
    const foreign = new URL(callback);
    foreign.hostname = "example.com";
    expect(session.acceptCallback(foreign.href)).toBe(false);
    const expired = new URL(callback);
    expired.searchParams.set("token", `h.${Buffer.from('{"exp":1}').toString("base64url")}.s`);
    expect(session.acceptCallback(expired.href)).toBe(false);
    expect(session.acceptCallback(callback.href)).toBe(true);
    expect(await session.token).toBe(token);
    expect(session.acceptCallback(callback.href)).toBe(false);
  } finally {
    session.close();
  }
});
