import { describe, expect, it } from "vite-plus/test";

import { orderRequestMessage, parseOrderResponse } from "../../src/tscircuit/orderRequest";

const response = (fields: Record<string, unknown>) => ({
  tscircuit_desktop_type: "order_output",
  request_id: "r1",
  ...fields,
});

describe("parseOrderResponse", () => {
  it("takes the answer to its own request, and nothing else", () => {
    const answer = response({ ok: true, files: { "bom.csv": "Designator\\n" } });
    expect(parseOrderResponse(answer, "r1")).toEqual({ ok: true, payload: answer });
    expect(parseOrderResponse(answer, "r2")).toBeNull();
    expect(parseOrderResponse({ runframe_type: "runframe_event" }, "r1")).toBeNull();
    const request = { kind: "bom", projectName: "led", circuitJsonText: null } as const;
    expect(parseOrderResponse(orderRequestMessage("r1", request), "r1")).toBeNull();
    expect(parseOrderResponse(null, "r1")).toBeNull();
  });

  it("passes on the viewer's error", () => {
    expect(
      parseOrderResponse(response({ ok: false, error_message: "No pcb_board" }), "r1"),
    ).toEqual({
      ok: false,
      message: "No pcb_board",
    });
    expect(parseOrderResponse(response({}), "r1")).toEqual({ ok: false, message: "Unknown error" });
  });
});
