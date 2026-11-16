/**
 * tscircuit desktop: how the Order pane asks the viewer frame for something
 * made from the circuit it last rendered (public/tscircuit-viewer/frame.html).
 */
import { randomUUID } from "~/lib/utils";

const REQUEST_TYPE = "get_order_output";
const RESPONSE_TYPE = "order_output";

export type OrderRequestKind =
  | "circuit_json"
  | "gerbers"
  | "bom"
  | "pick_and_place"
  | "kicad_project"
  | "jlcpcb_quote";

export interface OrderRequest {
  readonly kind: OrderRequestKind;
  /** Names the files of a KiCad project. */
  readonly projectName: string;
  /** A build's Circuit JSON to work from. Without it the viewer uses the circuit it last ran. */
  readonly circuitJsonText: string | null;
}

/** What the frame made. The frame runs project code, so each reader checks what it takes from this. */
export type OrderResponsePayload = Readonly<Record<string, unknown>>;

type OrderResponse =
  | { readonly ok: true; readonly payload: OrderResponsePayload }
  | { readonly ok: false; readonly message: string };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const orderRequestMessage = (requestId: string, request: OrderRequest) => ({
  tscircuit_desktop_type: REQUEST_TYPE,
  request_id: requestId,
  kind: request.kind,
  project_name: request.projectName,
  ...(request.circuitJsonText === null ? {} : { circuit_json_text: request.circuitJsonText }),
});

/** Null for a message that is not the answer to `requestId`. */
export function parseOrderResponse(data: unknown, requestId: string): OrderResponse | null {
  if (
    !isRecord(data) ||
    data.tscircuit_desktop_type !== RESPONSE_TYPE ||
    data.request_id !== requestId
  ) {
    return null;
  }
  if (data.ok === true) return { ok: true, payload: data };
  return {
    ok: false,
    message: typeof data.error_message === "string" ? data.error_message : "Unknown error",
  };
}

export function requestFromViewer(input: {
  readonly viewer: Window;
  readonly targetOrigin: string;
  readonly request: OrderRequest;
  readonly timeoutMs: number;
}): Promise<OrderResponsePayload> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const finish = (settle: () => void) => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
      settle();
    };
    const onMessage = (event: MessageEvent) => {
      // In a browser the frame's origin is "null", so its window is what names it.
      if (event.source !== input.viewer) return;
      const response = parseOrderResponse(event.data, requestId);
      if (response === null) return;
      finish(() => (response.ok ? resolve(response.payload) : reject(new Error(response.message))));
    };
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error("The circuit viewer took too long to answer."))),
      input.timeoutMs,
    );
    window.addEventListener("message", onMessage);
    input.viewer.postMessage(orderRequestMessage(requestId, input.request), input.targetOrigin);
  });
}
