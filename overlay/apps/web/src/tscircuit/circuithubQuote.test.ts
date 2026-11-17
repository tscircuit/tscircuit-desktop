import { describe, expect, it } from "vite-plus/test";
import { parseCircuithubQuantities, quotePrice } from "./circuithubQuote";

describe("CircuitHub quote inputs", () => {
  it("accepts separate quantities and removes duplicates", () => {
    expect(parseCircuithubQuantities("1, 5,10,5")).toEqual([1, 5, 10]);
  });
  it.each(["", "0", "-1", "1.5", "1,", "1e3", "100001", "1,".repeat(13)])(
    "rejects an invalid quantity list: %s",
    (text) => {
      expect(() => parseCircuithubQuantities(text)).toThrow();
    },
  );
  it("formats the quote in its stated currency", () => {
    expect(quotePrice("125.50", "USD")).toContain("125.50");
    expect(quotePrice("not available", "USD")).toBe("not available USD");
  });
});
