const MAX_BUILD_BYTES = 20 * 1024 * 1024;

export interface SavedCircuitBuild {
  readonly id: string;
  readonly at: number | null;
  readonly label: string;
  readonly path: string;
}

export function isDrawableCircuitBuild(text: string | undefined) {
  if (text === undefined || text.length > MAX_BUILD_BYTES) return false;
  try {
    const records: unknown = JSON.parse(text);
    if (!Array.isArray(records) || records.length === 0) return false;
    let drawable = false;
    for (const record of records as unknown[]) {
      if (
        typeof record !== "object" ||
        record === null ||
        !("type" in record) ||
        typeof record.type !== "string"
      )
        return false;
      if (
        /^(pcb_|schematic_|system_block_|simulation_)/.test(record.type) &&
        !record.type.includes("error")
      )
        drawable = true;
    }
    const bytes = new TextEncoder().encode(text).length;
    return bytes <= MAX_BUILD_BYTES && drawable;
  } catch {
    return false;
  }
}
