import { expect, it, vi } from "vite-plus/test";
import * as Redacted from "effect/Redacted";
import type { DesktopBridge } from "@t3tools/contracts";
import { render } from "../../test/render";
import { CircuithubQuotePanel } from "./CircuithubQuotePanel";

const { requestBrowser } = vi.hoisted(() => ({ requestBrowser: vi.fn() }));
vi.mock(import("./circuithubBrowser"), () => ({ requestCircuithubBrowser: requestBrowser }));
const account = {
  connected: false,
  displayName: null,
  expiresAt: null,
  loginPending: false,
  persistent: false,
  progress: null,
};
const props = {
  projectName: "board",
  run: 1,
  circuitJsonText: null,
  ready: true,
  files: async () => ({}),
};
function withDesktopBridge(value: DesktopBridge | undefined) {
  const descriptor = Object.getOwnPropertyDescriptor(window, "desktopBridge");
  Object.defineProperty(window, "desktopBridge", { value, configurable: true });
  return {
    [Symbol.dispose]() {
      if (descriptor) Object.defineProperty(window, "desktopBridge", descriptor);
      else Reflect.deleteProperty(window, "desktopBridge");
      requestBrowser.mockReset();
    },
  };
}

it("opens the actual authorization link and completes the pasted callback in a web preview", async () => {
  using _bridge = withDesktopBridge(undefined);
  const authorizationUrl =
    "https://app.circuithub.com/platform/v1/auth/cli?redirect_uri=http://localhost:12345/circuithub/callback/nonce";
  let connected = false;
  let loginPending = false;
  requestBrowser.mockImplementation(async (request) => {
    if (request.action === "login") loginPending = true;
    if (request.action === "complete_login") {
      expect(Redacted.value(request.callbackUrl)).toBe(
        "http://localhost:12345/circuithub/callback/nonce?token=fake-session",
      );
      connected = true;
      loginPending = false;
    }
    return {
      ok: true,
      account: { ...account, connected, loginPending },
      quote: null,
      error: null,
      authorizationUrl: loginPending ? authorizationUrl : null,
    };
  });
  await using screen = await render(
    <ul>
      <CircuithubQuotePanel {...props} />
    </ul>,
    { router: false },
  );
  expect(screen.container.querySelector('a[href="https://app.circuithub.com/"]')).toBeNull();
  await screen.getByRole("button", { name: /Connect CircuitHub/ }).click();
  await expect
    .element(screen.getByRole("link", { name: "Authorize CircuitHub (Link your CLI)" }))
    .toHaveAttribute("href", authorizationUrl);
  await screen
    .getByLabelText("Callback URL from the authorization tab")
    .fill("http://localhost:12345/circuithub/callback/nonce?token=fake-session");
  await screen.getByRole("button", { name: "Finish linking CircuitHub" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Disconnect", exact: true }))
    .toBeVisible();
  expect(screen.container.querySelector('input[type="password"]')).toBeNull();
});

it("makes the native authorization handler the primary desktop action", async () => {
  const native = vi.fn(async () => ({
    ok: true,
    account: { ...account, loginPending: true },
    quote: null,
    error: null,
  }));
  using _bridge = withDesktopBridge({ circuithub: native } as unknown as DesktopBridge);
  await using screen = await render(
    <ul>
      <CircuithubQuotePanel {...props} />
    </ul>,
    { router: false },
  );
  await screen.getByRole("button", { name: /Connect CircuitHub/ }).click();
  expect(native).toHaveBeenCalledWith({ action: "login" });
  expect(requestBrowser).not.toHaveBeenCalled();
  expect(screen.container.querySelector('a[href="https://app.circuithub.com/"]')).toBeNull();
});
