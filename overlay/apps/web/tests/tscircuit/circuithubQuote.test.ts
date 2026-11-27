import { describe, expect, it } from "vite-plus/test";
import {
  chooseCircuithubWorkspace,
  isCircuithubPriceReady,
  parseCircuithubQuantities,
  quotePrice,
} from "../../src/tscircuit/circuithubQuote";

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

describe("CircuitHub price readiness", () => {
  it.each([
    { camReady: false, status: "complete", ready: false },
    { camReady: true, status: "pending", ready: false },
    { camReady: true, status: "processing", ready: false },
    { camReady: true, status: "", ready: false },
    { camReady: true, status: "unknown_future_status", ready: false },
    { camReady: true, status: "complete", ready: true },
  ])("CAM $camReady and quote $status gives ready=$ready", ({ camReady, status, ready }) => {
    expect(isCircuithubPriceReady(camReady, status)).toBe(ready);
  });
});

describe("CircuitHub workspace selection", () => {
  it("retains an available saved workspace and discards slugs unavailable to the current account", () => {
    const choices = [{ slug: "alpha" }, { slug: "beta" }];
    expect(chooseCircuithubWorkspace(choices, "beta")).toBe("beta");
    expect(chooseCircuithubWorkspace(choices, "another-account")).toBe("");
    expect(chooseCircuithubWorkspace([{ slug: "only-team" }], "")).toBe("only-team");
    expect(chooseCircuithubWorkspace([], "beta")).toBe("");
  });
});
