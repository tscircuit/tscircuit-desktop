// @effect-diagnostics globalTimers:off -- Abortable native fetch workflow schedules its import polling outside Effect fibers.
import * as Schema from "effect/Schema";
import type {
  CircuithubAccount,
  CircuithubQuoteResult,
  CircuithubRequest,
  CircuithubResponse,
} from "@t3tools/contracts";
import { createApi, CircuitHubHttpError, checkoutUrl, isBoardMeasured } from "./api.ts";
import { startLogin, tokenClaims } from "./login.ts";

const isCircuitHubHttpError = Schema.is(CircuitHubHttpError);

interface Options {
  readonly readToken: () => Promise<string | null>;
  readonly writeToken: (token: string) => Promise<boolean>;
  readonly clearToken: () => Promise<void>;
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly fetch?: typeof fetch;
  readonly login?: typeof startLogin;
  readonly pause?: (signal: AbortSignal) => Promise<void>;
}

const pause = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 3000);
    signal.addEventListener("abort", abort, { once: true });
  });

export function validateProject(input: Extract<CircuithubRequest, { action: "create" }>): void {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.workspace))
    throw new Error("Enter your CircuitHub workspace slug.");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.projectName))
    throw new Error("Project names may contain letters, numbers, hyphens and underscores.");
  if (input.projectId === null && !input.exportClassification.trim())
    throw new Error(
      "Enter the board's export classification, or use an existing CircuitHub project.",
    );
  const names = new Set<string>();
  let bytes = 0;
  for (const file of input.files) {
    if (
      !/^[A-Za-z0-9_.-]+\.(kicad_pcb|kicad_sch|kicad_pro|kicad_sym)$/.test(file.filename) ||
      file.filename.startsWith(".") ||
      names.has(file.filename)
    )
      throw new Error("The CircuitHub export contains an invalid or duplicate filename.");
    names.add(file.filename);
    bytes += new TextEncoder().encode(file.content).length;
  }
  if (bytes > 25_000_000)
    throw new Error("The CircuitHub project is too large to upload (25 MB maximum).");
  for (const ext of ["kicad_pcb", "kicad_sch", "kicad_pro"]) {
    if (!names.has(`${input.projectName}.${ext}`))
      throw new Error("CircuitHub needs the complete KiCad project, board and schematic.");
  }
}

export function createCircuithubService(options: Options) {
  let token: string | null = null;
  let persistent = false;
  let loaded: Promise<void> | null = null;
  let login: Awaited<ReturnType<typeof startLogin>> | null = null;
  let generation = 0;
  let loginCompletion: Promise<void> | null = null;
  let progress: string | null = null;
  let active: AbortController | null = null;
  let authError: string | null = null;
  let storageQueue = Promise.resolve();
  const serializeStorage = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = storageQueue.then(operation, operation);
    storageQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const load = () =>
    (loaded ??= options
      .readToken()
      .then((saved) => {
        if (generation === 0 && saved && tokenClaims(saved)) {
          token = saved;
          persistent = true;
        }
      })
      .catch(() => {
        authError = "Could not unlock the saved CircuitHub session. Sign in again.";
      }));
  const account = (): CircuithubAccount => {
    const claims = token ? tokenClaims(token) : null;
    return {
      connected: claims !== null,
      displayName: claims?.name ?? null,
      expiresAt: claims?.expiresAt ?? null,
      persistent,
      loginPending: login !== null,
      progress,
    };
  };
  const resetLogin = () => {
    generation += 1;
    login?.close();
    login = null;
    loginCompletion = null;
  };
  const logout = async () => {
    resetLogin();
    active?.abort();
    token = null;
    persistent = false;
    authError = null;
    await serializeStorage(options.clearToken);
  };
  async function beginLogin() {
    if (login || account().connected) return;
    if (active) throw new Error("Cancel the running quote before changing accounts.");
    authError = null;
    const attempt = ++generation;
    const session = await (options.login ?? startLogin)();
    if (attempt !== generation) {
      session.close();
      return;
    }
    login = session;
    loginCompletion = session.token
      .then(async (received) => {
        if (attempt !== generation) return;
        const saved = await serializeStorage(async () =>
          attempt === generation ? options.writeToken(received) : false,
        );
        if (attempt !== generation) return;
        token = received;
        persistent = saved;
        authError = null;
      })
      .catch(() => {
        if (attempt === generation)
          authError = "CircuitHub sign-in did not complete. Please try again.";
      })
      .finally(() => {
        session.close();
        if (attempt === generation) {
          login = null;
          loginCompletion = null;
        }
      });
    try {
      if (!(await options.openBrowser(session.url)))
        throw new Error("Could not open CircuitHub sign-in in your browser.");
    } catch (error) {
      resetLogin();
      throw error;
    }
  }

  async function quote(
    request: Extract<CircuithubRequest, { action: "create" | "refresh" }>,
  ): Promise<CircuithubQuoteResult> {
    if (active) throw new Error("A CircuitHub quote is already running.");
    if (!token || !tokenClaims(token))
      throw new Error("Sign in to CircuitHub before requesting a quote.");
    if (request.action === "create") validateProject(request);
    const controller = new AbortController();
    const requestGeneration = generation;
    active = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12 * 60_000)]);
    const api = createApi(token, signal, options.fetch);
    const sleep = options.pause ?? pause;
    try {
      let projectId: number;
      let revisionId: number;
      if (request.action === "create") {
        progress = "Uploading the KiCad project";
        const encoded = request.files.map((file) => ({
          filename: file.filename,
          content: new TextEncoder().encode(file.content),
        }));
        const uploads = await api.uploads(
          request.workspace,
          encoded.map((file) => ({ filename: file.filename, size: file.content.length })),
        );
        if (!Array.isArray(uploads.uploads) || uploads.uploads.length !== encoded.length)
          throw new Error("CircuitHub did not accept every project file.");
        const seen = new Set<string>();
        for (const upload of uploads.uploads) {
          const file = encoded.find((file) => file.filename === upload.filename);
          if (!file || seen.has(file.filename))
            throw new Error("CircuitHub returned unexpected upload files.");
          seen.add(file.filename);
          await api.upload(upload, file.content);
        }
        const refs = uploads.uploads.map(({ filename, objectKey }) => ({ filename, objectKey }));
        const created =
          request.projectId !== null
            ? await api.revision(request.projectId, refs)
            : await api.create({
                name: request.projectName,
                workspace: request.workspace,
                exportClassification: request.exportClassification,
                files: refs,
              });
        projectId = created.projectId;
        revisionId = created.revisionId;
        if (
          !Number.isSafeInteger(projectId) ||
          projectId < 1 ||
          !Number.isSafeInteger(revisionId) ||
          revisionId < 1
        )
          throw new Error("CircuitHub returned an invalid project revision.");
        progress = "CircuitHub is importing the design";
        for (let attempt = 0; ; attempt += 1) {
          const status = await api.status(projectId);
          if (status.status === "complete") break;
          if (status.status !== "importing")
            throw new Error(
              "CircuitHub could not import this design. Check the KiCad files and try again.",
            );
          if (attempt >= 200)
            throw new Error(
              "CircuitHub's import is taking too long. Open the project in CircuitHub to check its status.",
            );
          await sleep(signal);
        }
      } else {
        projectId = request.projectId;
        revisionId = request.revisionId;
      }
      progress = "Fetching prices and part availability";
      const board = await api.board(revisionId);
      const quotes = [];
      for (const quantity of new Set(request.quantities)) {
        const result = await api.quote(revisionId, quantity);
        quotes.push({
          id: result.id,
          quantity: result.quantity,
          currency: result.currency ?? "USD",
          status: result.status,
          orderable: result.orderable === true,
          offers: result.offers.map((offer) => ({
            id: offer.id,
            service: offer.service,
            checkoutUrl: checkoutUrl(offer.checkoutUrl),
            total: offer.price.manufacturingTotal,
            unitPrice: offer.price.manufacturingUnitPrice ?? null,
            ships: offer.shipDate?.latest ?? offer.shipDate?.earliest ?? null,
          })),
          blockers: (result.blockers ?? []).map((blocker) => blocker.code),
        });
      }
      const bom = await api.bom(projectId);
      signal.throwIfAborted();
      if (requestGeneration !== generation)
        throw new Error("The CircuitHub account changed. Request a new quote.");
      return {
        projectId,
        revisionId,
        camReady: isBoardMeasured(board),
        quotes,
        unresolvedParts: bom.bomLines
          .filter((line) => line.status === "unresolved" || line.status === "errored")
          .flatMap((line) => line.placements?.map((p) => p.ref) ?? line.referenceDesignators ?? []),
      };
    } catch (error) {
      if (isCircuitHubHttpError(error) && error.status === 401) {
        await logout();
        throw error;
      }
      if (signal.aborted)
        throw new Error(
          controller.signal.aborted
            ? "CircuitHub quote cancelled. A project already uploaded to CircuitHub is kept there."
            : "CircuitHub took too long to respond. Please try again.",
          { cause: error },
        );
      throw error;
    } finally {
      if (active === controller) {
        active = null;
        progress = null;
      }
    }
  }

  return {
    async request(
      request:
        | CircuithubRequest
        | { readonly action: "complete_login"; readonly callbackUrl: string },
    ): Promise<CircuithubResponse> {
      await load();
      try {
        let result: CircuithubQuoteResult | null = null;
        switch (request.action) {
          case "status":
            break;
          case "complete_login": {
            const completion = loginCompletion;
            const attempt = generation;
            if (!login || !completion || !login.acceptCallback(request.callbackUrl))
              throw new Error(
                "This callback URL does not match the active CircuitHub sign-in, or its token has expired. Open the authorization link again.",
              );
            await completion;
            if (attempt !== generation) throw new Error("CircuitHub sign-in was cancelled.");
            if (authError) throw new Error(authError);
            break;
          }
          case "login":
            await beginLogin();
            break;
          case "logout":
            await logout();
            break;
          case "cancel":
            resetLogin();
            active?.abort();
            authError = null;
            break;
          case "create":
          case "refresh":
            result = await quote(request);
            break;
        }
        return { ok: true, account: account(), quote: result, error: authError };
      } catch (error) {
        return {
          ok: false,
          account: account(),
          quote: null,
          error:
            error instanceof Error ? error.message : "CircuitHub could not complete this request.",
        };
      }
    },
    get authorizationUrl() {
      return login?.url ?? null;
    },
    close() {
      resetLogin();
      active?.abort();
    },
  };
}
