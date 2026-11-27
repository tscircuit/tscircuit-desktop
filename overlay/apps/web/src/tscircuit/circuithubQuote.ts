export function parseCircuithubQuantities(text: string): readonly number[] {
  const values = text.split(",").map((value) => value.trim());
  if (
    values.length < 1 ||
    values.length > 12 ||
    values.some((value) => !/^[1-9]\d*$/.test(value) || Number(value) > 100_000)
  ) {
    throw new Error("Enter up to 12 quantities between 1 and 100000, separated by commas.");
  }
  return [...new Set(values.map(Number))];
}

export function quotePrice(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Keep unknown pricing states provisional until the API explicitly reports completion. */
export function isCircuithubPriceReady(camReady: boolean, status: string): boolean {
  return camReady && status === "complete";
}

/** Never reuse a saved slug that is not available to the current account. */
export function chooseCircuithubWorkspace(
  workspaces: readonly { readonly slug: string }[],
  previous: string,
): string {
  if (workspaces.some((workspace) => workspace.slug === previous)) return previous;
  return workspaces.length === 1 ? workspaces[0]!.slug : "";
}
