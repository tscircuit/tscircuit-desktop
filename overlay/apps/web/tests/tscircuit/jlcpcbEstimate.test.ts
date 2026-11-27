import { describe, expect, it } from "vite-plus/test";

import {
  describeEstimateOrder,
  formatEstimateTotal,
  type JlcpcbEstimate,
  readJlcpcbEstimate,
} from "../../src/tscircuit/jlcpcbEstimate";

/** The frame's answer for a two-part board, as circuit-json-to-jlcpcb-quote 0.0.4 gives it. */
const quote = () => ({
  order: { quantity: 5, assembledQuantity: 2, assembly: "economic" },
  summary: {
    rows: [
      { key: "fabrication", label: "PCB fabrication, 5 boards", total: 4.05, perBoard: 0.81 },
      { key: "parts", label: "Parts", total: 0.01, note: "Parts for 2 boards (2 unique)" },
      { key: "shipping", label: "Shipping, DHL Express (DDP)", total: 27.89 },
    ],
    grandTotal: { label: "Grand total", total: 57.41, lowTotal: 49.05, highTotal: 68.57 },
  },
  excluded_designators: ["J1", "U3"],
  destination_note: "Shipping and taxes assume delivery to the United States.",
  warnings: [],
});

describe("readJlcpcbEstimate", () => {
  it("reads the order, each expense and the total", () => {
    expect(readJlcpcbEstimate({ quote: quote() })).toEqual({
      boards: 5,
      assembledBoards: 2,
      total: 57.41,
      lowTotal: 49.05,
      highTotal: 68.57,
      rows: [
        { label: "PCB fabrication, 5 boards", total: 4.05, note: null },
        { label: "Parts", total: 0.01, note: "Parts for 2 boards (2 unique)" },
        { label: "Shipping, DHL Express (DDP)", total: 27.89, note: null },
      ],
      unpricedDesignators: ["J1", "U3"],
      destinationNote: "Shipping and taxes assume delivery to the United States.",
    } satisfies JlcpcbEstimate);
  });

  it("gives no estimate for an answer it cannot read whole, since a partial one would come out low", () => {
    const broken: Array<(q: ReturnType<typeof quote>) => unknown> = [
      () => undefined,
      (q) => ({ ...q, summary: undefined }),
      (q) => ({ ...q, summary: { ...q.summary, grandTotal: { total: "57.41" } } }),
      (q) => ({ ...q, summary: { ...q.summary, grandTotal: { total: Number.NaN } } }),
      (q) => ({ ...q, summary: { ...q.summary, rows: [] } }),
      (q) => ({ ...q, summary: { ...q.summary, rows: [...q.summary.rows, { label: "Tax" }] } }),
      (q) => ({ ...q, order: { quantity: 0 } }),
    ];
    for (const change of broken) {
      expect(readJlcpcbEstimate({ quote: change(quote()) })).toBeNull();
    }
  });

  it("does without the parts of an answer that only add detail", () => {
    const { excluded_designators: _, destination_note: __, ...bare } = quote();
    const estimate = readJlcpcbEstimate({
      quote: {
        ...bare,
        order: { quantity: 5 },
        summary: { ...bare.summary, grandTotal: { total: 9 } },
      },
    });
    expect(estimate).toMatchObject({
      assembledBoards: 0,
      lowTotal: 9,
      highTotal: 9,
      unpricedDesignators: [],
      destinationNote: null,
    });
  });
});

describe("how an estimate is worded", () => {
  const estimate = readJlcpcbEstimate({ quote: quote() });
  if (estimate === null) throw new Error("The fixture should read as an estimate");

  it("rounds the price beside the link to the dollar", () => {
    expect(formatEstimateTotal(estimate)).toBe("~$57");
    expect(formatEstimateTotal({ ...estimate, total: 1234.5 })).toBe("~$1,235");
  });

  it("says what order the price is for", () => {
    expect(describeEstimateOrder(estimate)).toBe("5 boards, 2 of them assembled");
    expect(describeEstimateOrder({ ...estimate, assembledBoards: 0 })).toBe("5 bare boards");
  });
});
