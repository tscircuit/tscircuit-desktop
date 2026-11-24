import type {
  CircuithubAccount,
  CircuithubWorkspace,
  CircuithubQuoteResult,
  CircuithubRequest,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Redacted from "effect/Redacted";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { requestCircuithubBrowser } from "./circuithubBrowser";
import type { OrderFileContents } from "./orderFiles";
import {
  chooseCircuithubWorkspace,
  isCircuithubPriceReady,
  parseCircuithubQuantities,
  quotePrice,
} from "./circuithubQuote";

const CLASSIFICATIONS = [
  { value: "EAR99", label: "EAR99" },
  { value: "NotExportControlled", label: "Not export controlled" },
  { value: "other", label: "Other classification (ECCN)" },
];
const WORKSPACE_KEY = "tscircuit-desktop:circuithub-workspace";
const ACCOUNT: CircuithubAccount = {
  connected: false,
  displayName: null,
  expiresAt: null,
  loginPending: false,
  persistent: false,
  progress: null,
};

export function CircuithubQuotePanel(props: {
  readonly projectName: string;
  readonly run: number;
  readonly circuitJsonText: string | null;
  readonly ready: boolean;
  readonly files: () => Promise<OrderFileContents>;
}) {
  const nativeApi = window.desktopBridge?.circuithub;
  const api = nativeApi ?? requestCircuithubBrowser;
  const browserMode = nativeApi === undefined;
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [linking, setLinking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [account, setAccount] = useState(ACCOUNT);
  const [workspace, setWorkspace] = useState(
    () => getLocalStorageItem(WORKSPACE_KEY, Schema.String) ?? "",
  );
  const [quantities, setQuantities] = useState("1,5,10");
  const [classificationChoice, setClassificationChoice] = useState("EAR99");
  const [customClassification, setCustomClassification] = useState("");
  const classification =
    classificationChoice === "other" ? customClassification : classificationChoice;
  const [workspaces, setWorkspaces] = useState<readonly CircuithubWorkspace[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceRefresh, setWorkspaceRefresh] = useState(0);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    readonly quote: CircuithubQuoteResult;
    readonly run: number;
    readonly circuitJsonText: string | null;
  } | null>(null);
  const quoteAttempt = useRef(0);
  const id = useId();
  const stale =
    result !== null &&
    (result.run !== props.run || result.circuitJsonText !== props.circuitJsonText || !props.ready);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads native account and import progress; credentials never cross the bridge
  useEffect(() => {
    if (!expanded) return;
    let disposed = false;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const response = await api({ action: "status" });
        if (!disposed) {
          setAccount(response.account);
          if (!response.account.loginPending) setCallbackUrl("");
          setAuthorizationUrl(
            "authorizationUrl" in response && typeof response.authorizationUrl === "string"
              ? response.authorizationUrl
              : null,
          );
          if (response.error) setError(response.error);
        }
      } catch {
        if (!disposed)
          setError(
            "Could not access CircuitHub account settings. Check your workspace connection and account-management permissions.",
          );
      }
      reading = false;
    };
    void read();
    const interval = window.setInterval(() => void read(), 2000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [expanded, api]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads account-owned workspaces after sign-in; discards responses after account changes
  useEffect(() => {
    if (!expanded || !account.connected) return;
    let disposed = false;
    const accountExpiry = account.expiresAt;
    void Promise.resolve()
      .then(() => {
        if (disposed || (accountExpiry !== null && accountExpiry <= Date.now())) return;
        setLoadingWorkspaces(true);
        setWorkspaceError(null);
        setWorkspaces([]);
        return api({ action: "workspaces" });
      })
      .then((response) => {
        if (disposed || !response) return;
        setAccount(response.account);
        setLoadingWorkspaces(false);
        if (!response.ok) {
          setWorkspaceError(response.error ?? "Could not load your CircuitHub workspaces.");
          return;
        }
        const choices = response.workspaces ?? [];
        setWorkspaces(choices);
        setWorkspace((previous) => chooseCircuithubWorkspace(choices, previous));
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLoadingWorkspaces(false);
          setWorkspaceError(
            error instanceof Error ? error.message : "Could not load your CircuitHub workspaces.",
          );
        }
      });
    return () => {
      disposed = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- workspaceRefresh explicitly retries loading the account-owned workspace list
  }, [expanded, account.connected, account.expiresAt, workspaceRefresh, api]);

  const invoke = async (request: CircuithubRequest) => {
    const response = await api(request);
    setAccount(response.account);
    setAuthorizationUrl(
      "authorizationUrl" in response && typeof response.authorizationUrl === "string"
        ? response.authorizationUrl
        : null,
    );
    if (!response.ok)
      throw new Error(response.error ?? "CircuitHub could not complete this request.");
    return response;
  };
  const accountAction = async (action: "login" | "logout" | "cancel") => {
    setError(null);
    setCallbackUrl("");
    if (action === "cancel" || action === "logout") quoteAttempt.current += 1;
    try {
      await invoke({ action });
      if (action === "logout") {
        setResult(null);
        setProjectId("");
        setWorkspaces([]);
        setWorkspaceError(null);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "CircuitHub sign-in failed.");
    }
  };
  const completeAccount = async () => {
    setLinking(true);
    setError(null);
    const pastedCallback = callbackUrl;
    setCallbackUrl("");
    try {
      const response = await requestCircuithubBrowser({
        action: "complete_login",
        callbackUrl: Redacted.make(pastedCallback),
      });
      setAccount(response.account);
      setAuthorizationUrl(response.authorizationUrl);
      if (!response.ok) setError(response.error ?? "CircuitHub sign-in did not complete.");
    } catch {
      setError("Could not finish CircuitHub sign-in. Try the authorization link again.");
    }
    setLinking(false);
  };
  const getQuote = async (refresh: boolean) => {
    const attempt = ++quoteAttempt.current;
    setBusy(true);
    setError(null);
    const snapshot = { run: props.run, circuitJsonText: props.circuitJsonText };
    const runQuote = async () => {
      const counts = parseCircuithubQuantities(quantities);
      let request: CircuithubRequest;
      if (refresh && result) {
        request = {
          action: "refresh",
          quantities: counts,
          projectId: result.quote.projectId,
          revisionId: result.quote.revisionId,
        };
      } else {
        const existingProject = projectId.trim() === "" ? null : Number(projectId);
        if (
          existingProject !== null &&
          (!Number.isSafeInteger(existingProject) || existingProject < 1)
        )
          throw new Error("Enter a valid CircuitHub project ID.");
        if (!workspace.trim()) throw new Error("Enter your CircuitHub workspace slug.");
        if (existingProject === null && !classification.trim())
          throw new Error(
            "Enter the board's export classification, or use an existing CircuitHub project.",
          );
        const files = await props.files();
        if (attempt !== quoteAttempt.current) return;
        request = {
          action: "create",
          workspace: workspace.trim(),
          projectName: props.projectName,
          exportClassification: classification.trim(),
          projectId: existingProject,
          quantities: counts,
          files: Object.entries(files).map(([filename, content]) => ({ filename, content })),
        };
      }
      const response = await invoke(request);
      if (response.quote) {
        setResult({
          quote: response.quote,
          ...(refresh && result
            ? { run: result.run, circuitJsonText: result.circuitJsonText }
            : snapshot),
        });
        setProjectId(String(response.quote.projectId));
        setLocalStorageItem(WORKSPACE_KEY, workspace.trim(), Schema.String);
      }
    };
    try {
      await runQuote();
    } catch (error) {
      setError(error instanceof Error ? error.message : "CircuitHub could not quote this board.");
    }
    setBusy(false);
  };

  return (
    <li>
      <div className="flex items-center">
        <Button
          variant="ghost"
          className="min-w-0 flex-1 justify-between"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            if (!account.connected && !account.loginPending) {
              setExpanded(true);
              void accountAction("login");
            } else setExpanded((value) => !value);
          }}
        >
          <span>{account.connected ? "CircuitHub" : "Connect CircuitHub"}</span>
          <span className="flex items-center gap-2 text-muted-foreground text-xs">
            {account.connected ? "Connected" : "Connect for quotes"}
            <ChevronDownIcon className={cn("size-4", expanded && "rotate-180")} />
          </span>
        </Button>
      </div>
      {expanded ? (
        <div id={id} className="flex flex-col gap-3 border-t px-3.5 py-3 text-sm">
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {account.connected
                  ? `Signed in${account.displayName ? ` as ${account.displayName}` : ""}`
                  : account.loginPending
                    ? "Finish signing in in your browser"
                    : "Sign in to request assembled-board prices."}
              </span>
              {account.connected ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || account.progress !== null}
                  onClick={() => void accountAction("logout")}
                >
                  Disconnect
                </Button>
              ) : account.loginPending ? (
                <Button variant="outline" size="sm" onClick={() => void accountAction("cancel")}>
                  Cancel sign-in
                </Button>
              ) : (
                <Button size="sm" onClick={() => void accountAction("login")}>
                  Sign in to CircuitHub
                </Button>
              )}
            </div>
            {browserMode && account.loginPending && authorizationUrl ? (
              <div className="flex flex-col gap-2">
                <a
                  href={authorizationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Authorize CircuitHub (Link your CLI)
                </a>
                <p className="text-muted-foreground text-xs">
                  Complete authorization in that tab. It will redirect to localhost, which may show
                  a connection error because this workspace runs in the cloud. Copy the full URL
                  from the browser address bar and paste it below to finish linking.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void completeAccount();
                  }}
                  className="flex flex-col gap-2"
                >
                  <label htmlFor={`${id}-callback`}>Callback URL from the authorization tab</label>
                  <Input
                    id={`${id}-callback`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={callbackUrl}
                    onChange={(event) => setCallbackUrl(event.target.value)}
                    disabled={linking}
                  />
                  <Button type="submit" size="sm" disabled={linking || !callbackUrl.trim()}>
                    {linking ? "Linking account" : "Finish linking CircuitHub"}
                  </Button>
                </form>
              </div>
            ) : null}
            {account.connected ? (
              <a
                href="https://app.circuithub.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary text-xs underline"
              >
                Open CircuitHub dashboard
                <ExternalLinkIcon className="size-3" />
              </a>
            ) : null}
            {account.connected && !account.persistent ? (
              <p className="text-muted-foreground text-xs">
                {browserMode
                  ? "This account is linked only for this workspace session. Sign in again if the workspace restarts."
                  : "Your OS keychain is unavailable. This connection lasts until you close the app."}
              </p>
            ) : null}
            {account.connected ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${id}-workspace`}>Workspace</label>
                    <Select
                      value={
                        workspaces.some((choice) => choice.slug === workspace) ? workspace : null
                      }
                      disabled={busy || loadingWorkspaces || workspaces.length === 0}
                      items={workspaces.map((choice) => ({
                        value: choice.slug,
                        label:
                          choice.name === choice.slug
                            ? choice.slug
                            : `${choice.name} (${choice.slug})`,
                      }))}
                      onValueChange={(value) => setWorkspace(value ?? "")}
                    >
                      <SelectTrigger id={`${id}-workspace`} aria-label="Workspace">
                        <SelectValue
                          placeholder={
                            loadingWorkspaces
                              ? "Loading workspaces…"
                              : workspaceError
                                ? "Couldn't load workspaces"
                                : workspaces.length === 0
                                  ? "No workspaces available"
                                  : "Choose a workspace"
                          }
                        />
                      </SelectTrigger>
                      <SelectPopup>
                        {workspaces.map((choice) => (
                          <SelectItem key={choice.slug} value={choice.slug}>
                            {choice.name === choice.slug
                              ? choice.slug
                              : `${choice.name} (${choice.slug})`}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy || loadingWorkspaces}
                      onClick={() => setWorkspaceRefresh((value) => value + 1)}
                    >
                      {workspaceError ? "Retry loading workspaces" : "Refresh workspaces"}
                    </Button>
                    {workspaceError ? (
                      <p role="alert" className="text-xs">
                        {workspaceError}
                      </p>
                    ) : !loadingWorkspaces && workspaces.length === 0 ? (
                      <p className="text-muted-foreground text-xs">
                        Create or join a workspace in CircuitHub, then refresh this list.
                      </p>
                    ) : null}
                  </div>
                  <label className="flex flex-col gap-1" htmlFor={`${id}-quantities`}>
                    Board quantities
                    <Input
                      id={`${id}-quantities`}
                      value={quantities}
                      onChange={(event) => setQuantities(event.target.value)}
                      placeholder="1,5,10"
                      disabled={busy}
                    />
                  </label>
                  <label className="flex flex-col gap-1" htmlFor={`${id}-project`}>
                    Existing project ID (optional)
                    <Input
                      id={`${id}-project`}
                      value={projectId}
                      onChange={(event) => setProjectId(event.target.value)}
                      inputMode="numeric"
                      disabled={busy}
                    />
                  </label>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${id}-classification`}>Export classification</label>
                    <Select
                      value={classificationChoice}
                      items={CLASSIFICATIONS}
                      disabled={busy}
                      onValueChange={(value) => {
                        if (value !== null) setClassificationChoice(value);
                      }}
                    >
                      <SelectTrigger id={`${id}-classification`} aria-label="Export classification">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        {CLASSIFICATIONS.map((choice) => (
                          <SelectItem key={choice.value} value={choice.value}>
                            {choice.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                    {classificationChoice === "other" ? (
                      <>
                        <label htmlFor={`${id}-custom-classification`}>
                          Custom export classification
                        </label>
                        <Input
                          id={`${id}-custom-classification`}
                          value={customClassification}
                          onChange={(event) => setCustomClassification(event.target.value)}
                          placeholder="ECCN, for example 3A001"
                          disabled={busy}
                        />
                      </>
                    ) : null}
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  Choose a workspace from your CircuitHub account. Requesting a quote uploads this
                  board's KiCad design to CircuitHub. Nothing is ordered.
                </p>
                {!props.ready ? (
                  <p className="text-muted-foreground text-xs">
                    Wait for the board to finish building and resolve its errors before requesting a
                    quote.
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={
                      busy ||
                      account.progress !== null ||
                      !props.ready ||
                      loadingWorkspaces ||
                      !workspaces.some((choice) => choice.slug === workspace) ||
                      (!projectId.trim() && !classification.trim())
                    }
                    onClick={() => void getQuote(false)}
                  >
                    {projectId ? "Quote new revision" : "Get quote"}
                  </Button>
                  {result ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || account.progress !== null}
                      onClick={() => void getQuote(true)}
                    >
                      Refresh prices
                    </Button>
                  ) : null}
                  {busy || account.progress !== null ? (
                    <>
                      <Spinner className="size-4" />
                      <span className="text-muted-foreground text-xs">
                        {account.progress ?? "Preparing quote"}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void accountAction("cancel")}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
          {error ? (
            <Alert variant="error">
              <AlertTitle>CircuitHub needs attention</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {result ? (
            <>
              <p className="text-muted-foreground text-xs">
                Project {result.quote.projectId} · revision {result.quote.revisionId}
                {stale ? " · Quote is for an earlier version of this board." : ""}
              </p>
              {!result.quote.camReady ? (
                <p className="text-xs">
                  Preliminary prices: CircuitHub is still analysing this board. Refresh later for
                  updated prices and available services.
                </p>
              ) : null}
              {result.quote.unresolvedParts.length > 0 ? (
                <p className="text-xs">
                  Parts needing attention: {result.quote.unresolvedParts.join(", ")}
                </p>
              ) : null}
              {result.quote.quotes.map((quote) => (
                <div key={quote.id} className="flex flex-col gap-2">
                  <h4 className="font-medium">{quote.quantity} boards</h4>
                  <p className="text-xs" role="status">
                    {isCircuithubPriceReady(result.quote.camReady, quote.status)
                      ? "Prices ready"
                      : "Preliminary prices"}{" "}
                    · Quote status: {quote.status || "unknown"}
                  </p>
                  {!isCircuithubPriceReady(result.quote.camReady, quote.status) ? (
                    <p className="text-muted-foreground text-xs">
                      CircuitHub has not confirmed completed checks and pricing for this quote.
                      Refresh for updated prices; displayed prices may change.
                    </p>
                  ) : null}
                  {quote.blockers.length > 0 ? (
                    <p className="text-xs">Cannot order yet: {quote.blockers.join(", ")}</p>
                  ) : null}
                  {quote.offers.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      No offers available yet. Check the design in CircuitHub, then refresh prices.
                    </p>
                  ) : null}
                  {quote.offers.map((offer) => (
                    <div
                      key={offer.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                    >
                      <div>
                        <div>
                          {offer.service} · {quotePrice(offer.total, quote.currency)}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {offer.unitPrice
                            ? `${quotePrice(offer.unitPrice, quote.currency)} / board`
                            : ""}
                          {offer.ships ? ` · Ships ${offer.ships}` : ""}
                        </div>
                      </div>
                      {offer.checkoutUrl &&
                      quote.orderable &&
                      isCircuithubPriceReady(result.quote.camReady, quote.status) ? (
                        <a
                          href={offer.checkoutUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary text-xs underline"
                        >
                          Review in CircuitHub
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
