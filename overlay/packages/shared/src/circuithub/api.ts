import * as Schema from "effect/Schema";
/** CircuitHub v1 operations shared with tscircuit/cli's CircuitHub integration (MIT). */
export interface Upload {
  filename: string;
  objectKey: string;
  uploadUrl: string;
  headers?: readonly (readonly [string, string])[];
}
export interface Quote {
  id: number;
  quantity: number;
  currency?: string;
  status: string;
  orderable?: boolean;
  offers: {
    id: number;
    service: string;
    checkoutUrl?: string;
    price: { manufacturingTotal: string; manufacturingUnitPrice?: string };
    shipDate?: { earliest?: string; latest?: string };
  }[];
  blockers?: { code: string }[];
}
export interface Board {
  hasCamReport?: boolean;
  spec?: { minPitchMM?: number | null; minHoleSizeMM?: number | null };
}
export interface Bom {
  bomLines: { status: string; placements?: { ref: string }[]; referenceDesignators?: string[] }[];
}
export class CircuitHubHttpError extends Schema.TaggedError<CircuitHubHttpError>()(
  "CircuitHubHttpError",
  {
    status: Schema.Number,
    operation: Schema.optional(Schema.String),
    detail: Schema.optional(Schema.String),
    code: Schema.optional(Schema.String),
  },
) {
  override get message() {
    if (this.status === 401) return "Your CircuitHub session expired. Sign in again.";
    const operation = this.operation ? ` ${this.operation}` : " the request";
    const code = this.code ? ` [${this.code}]` : "";
    const detail = this.detail ? `: ${this.detail}` : ". Please try again.";
    return `CircuitHub rejected${operation} (HTTP ${this.status})${code}${detail}`;
  }
}

export function createApi(token: string, signal: AbortSignal, fetchFn = globalThis.fetch) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetchFn(`https://api.circuithub.com/v1${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      let detail: string | undefined;
      let code: string | undefined;
      try {
        const body = (await response.json()) as {
          error?: string | { message?: unknown; code?: unknown };
          message?: unknown;
          code?: unknown;
        };
        const nested = typeof body.error === "object" && body.error !== null ? body.error : null;
        const message = nested?.message ?? body.message ?? body.error;
        const errorCode = nested?.code ?? body.code;
        if (typeof errorCode === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(errorCode))
          code = errorCode;
        if (typeof message === "string" && response.status < 500 && response.status !== 401) {
          detail = message
            .replaceAll(token, "[redacted]")
            .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [redacted]")
            .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
            .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted URL]")
            .replace(/\p{Cc}/gu, " ")
            .slice(0, 500);
        }
      } catch {
        /* Non-JSON error pages are never echoed. */
      }
      throw new CircuitHubHttpError({
        status: response.status,
        operation: `${method} ${path}`,
        ...(detail ? { detail } : {}),
        ...(code ? { code } : {}),
      });
    }
    return (await response.json()) as T;
  }
  return {
    workspaces: () => call<{ workspaces: { slug: string; name?: string }[] }>("GET", "/workspaces"),
    uploads: (workspace: string, files: { filename: string; size: number }[]) =>
      call<{ uploads: Upload[] }>("POST", "/projects/upload-urls", { workspace, files }),
    upload: async (upload: Upload, content: Uint8Array) => {
      const url = new URL(upload.uploadUrl);
      if (url.protocol !== "https:") throw new Error("CircuitHub returned an unsafe upload URL.");
      // Presigned storage URLs use their own headers, never the CircuitHub bearer token.
      const response = await fetchFn(url, {
        method: "PUT",
        signal,
        headers: Object.fromEntries(upload.headers ?? []),
        body: content as NonNullable<RequestInit["body"]>,
      });
      if (!response.ok) throw new Error(`Could not upload ${upload.filename} to CircuitHub.`);
    },
    create: (input: {
      name: string;
      workspace: string;
      exportClassification: string;
      files: { filename: string; objectKey: string }[];
    }) => call<{ projectId: number; revisionId: number }>("POST", "/projects", input),
    revision: (projectId: number, files: { filename: string; objectKey: string }[]) =>
      call<{ projectId: number; revisionId: number }>("POST", `/projects/${projectId}/revisions`, {
        files,
      }),
    status: (projectId: number) => call<{ status: string }>("GET", `/projects/${projectId}/status`),
    board: (revisionId: number) => call<Board>("GET", `/revisions/${revisionId}/board`),
    quote: (revisionId: number, quantity: number) =>
      call<Quote>("POST", "/quotes", { revisionId, quantity }),
    bom: (projectId: number) => call<Bom>("GET", `/projects/${projectId}/bom`),
  };
}

export const isBoardMeasured = (board: Board) =>
  Boolean(
    board.hasCamReport && (board.spec?.minPitchMM ?? 0) > 0 && board.spec?.minHoleSizeMM != null,
  );

export function checkoutUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "circuithub.com" || url.hostname.endsWith(".circuithub.com")) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
