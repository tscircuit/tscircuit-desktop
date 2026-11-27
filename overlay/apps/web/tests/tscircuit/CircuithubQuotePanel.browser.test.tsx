import { page } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";
import * as Redacted from "effect/Redacted";
import type { DesktopBridge } from "@t3tools/contracts";
import { render } from "../../test/render";
import { CircuithubQuotePanel } from "../../src/tscircuit/CircuithubQuotePanel";

const { requestBrowser } = vi.hoisted(() => ({ requestBrowser: vi.fn() }));
vi.mock(import("../../src/tscircuit/circuithubBrowser"), () => ({
  requestCircuithubBrowser: requestBrowser,
}));
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
    "https://app.circuithub.com/oauth/authorize?redirect_uri=http://127.0.0.1:12345/callback&state=nonce";
  let connected = false;
  let loginPending = false;
  requestBrowser.mockImplementation(async (request) => {
    if (request.action === "login") loginPending = true;
    if (request.action === "complete_login") {
      expect(Redacted.value(request.callbackUrl)).toBe(
        "http://127.0.0.1:12345/callback?code=fake-code&state=nonce&iss=https%3A%2F%2Fapp.circuithub.com",
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
    .element(screen.getByRole("link", { name: "Authorize CircuitHub" }))
    .toHaveAttribute("href", authorizationUrl);
  await screen
    .getByLabelText("Callback URL from the authorization tab")
    .fill(
      "http://127.0.0.1:12345/callback?code=fake-code&state=nonce&iss=https%3A%2F%2Fapp.circuithub.com",
    );
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

it("selects an account workspace and submits EAR99 by default or a custom classification", async () => {
  using _bridge = withDesktopBridge(undefined);
  const connectedAccount = {
    ...account,
    connected: true,
    displayName: "abse",
    expiresAt: 1,
    scope: "read design issues",
  };
  requestBrowser.mockImplementation(async (request) => ({
    ok: request.action !== "create",
    account: connectedAccount,
    quote: null,
    error:
      request.action === "create"
        ? "CircuitHub rejected POST /projects (HTTP 400): Check project details"
        : null,
    workspaces:
      request.action === "workspaces"
        ? [
            { slug: "seveibar", name: "Seve's team" },
            { slug: "another-team", name: "Another team" },
          ]
        : undefined,
  }));
  await using screen = await render(
    <ul>
      <CircuithubQuotePanel
        {...props}
        files={async () => ({
          "board.kicad_pcb": "pcb",
          "board.kicad_sch": "schematic",
          "board.kicad_pro": "project",
        })}
      />
    </ul>,
    { router: false },
  );
  await screen.getByRole("button", { name: /Connect CircuitHub/ }).click();
  await screen.getByRole("combobox", { name: "Workspace", exact: true }).click();
  await page.getByRole("option", { name: "Seve's team (seveibar)", exact: true }).click();
  await expect
    .element(screen.getByRole("combobox", { name: "Export classification", exact: true }))
    .toHaveTextContent("EAR99");
  await screen.getByRole("button", { name: "Get quote", exact: true }).click();
  expect(requestBrowser).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "create",
      workspace: "seveibar",
      exportClassification: "EAR99",
    }),
  );
  await expect
    .element(
      screen.getByText("CircuitHub rejected POST /projects (HTTP 400): Check project details", {
        exact: true,
      }),
    )
    .toBeVisible();
  await screen.getByRole("combobox", { name: "Export classification", exact: true }).click();
  await page.getByRole("option", { name: "Not export controlled", exact: true }).click();
  await screen.getByRole("button", { name: "Get quote", exact: true }).click();
  expect(requestBrowser).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "create",
      workspace: "seveibar",
      exportClassification: "NotExportControlled",
    }),
  );
  await screen.getByRole("combobox", { name: "Export classification", exact: true }).click();
  await page.getByRole("option", { name: "Other classification (ECCN)", exact: true }).click();
  await screen.getByLabelText("Custom export classification", { exact: true }).fill("3A001");
  await screen.getByRole("button", { name: "Get quote", exact: true }).click();
  expect(requestBrowser).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "create",
      workspace: "seveibar",
      exportClassification: "3A001",
    }),
  );
});
