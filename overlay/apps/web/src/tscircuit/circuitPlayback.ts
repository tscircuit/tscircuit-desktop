export const PREVIEW_REQUEST_FILE = ".tscircuit-desktop/preview-request";
const MAX_STEPS = 40;
const MAX_SNAPSHOTS = 10;
const MAX_HISTORY_BYTES = 20 * 1024 * 1024;

export interface CircuitPreviewEvent {
  readonly previewId: string;
  readonly sequence: number;
  readonly observedAt: number;
  readonly stage: "started" | "routing" | "checks" | "completed" | "failed";
  readonly phaseStatus?: "running" | "complete" | "error";
  readonly reroute?: boolean;
  readonly checks?: ReadonlyArray<"source" | "placement" | "pcb">;
  readonly circuitJsonText?: string;
}

export interface CircuitPlaybackStep {
  readonly id: string;
  readonly at: number | null;
  readonly label: string;
  readonly snapshot: string | null;
  readonly snapshotEvicted?: boolean;
  readonly archivePath?: string;
  readonly bytes: number;
}

export function parseCircuitPreviewEvent(value: unknown): CircuitPreviewEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.previewId !== "string" ||
    data.previewId.length > 100 ||
    !Number.isSafeInteger(data.sequence) ||
    (data.sequence as number) < 0 ||
    typeof data.observedAt !== "number" ||
    !Number.isFinite(data.observedAt) ||
    !["started", "routing", "checks", "completed", "failed"].includes(String(data.stage)) ||
    (data.stage === "routing" &&
      !["running", "complete", "error"].includes(String(data.phaseStatus))) ||
    (data.stage === "checks" &&
      (!Array.isArray(data.checks) ||
        !data.checks.some((check) => ["source", "placement", "pcb"].includes(check))))
  )
    return null;
  return {
    previewId: data.previewId,
    sequence: data.sequence as number,
    observedAt: data.observedAt,
    stage: data.stage as CircuitPreviewEvent["stage"],
    ...(data.phaseStatus === "running" ||
    data.phaseStatus === "complete" ||
    data.phaseStatus === "error"
      ? { phaseStatus: data.phaseStatus }
      : {}),
    ...(Array.isArray(data.checks)
      ? {
          checks: [
            ...new Set(
              data.checks.filter((check): check is "source" | "placement" | "pcb" =>
                ["source", "placement", "pcb"].includes(check),
              ),
            ),
          ],
        }
      : {}),
    ...(data.reroute === true ? { reroute: true } : {}),
    ...(typeof data.circuitJsonText === "string" && data.circuitJsonText.length <= MAX_HISTORY_BYTES
      ? { circuitJsonText: data.circuitJsonText }
      : {}),
  };
}

export function inspectCircuitSnapshot(text: string | undefined) {
  if (text === undefined || text.length > MAX_HISTORY_BYTES) return null;
  try {
    const records: unknown = JSON.parse(text);
    if (!Array.isArray(records) || records.length === 0) return null;
    let drawable = false;
    let errorCount = 0;
    let routingFailed = false;
    for (const record of records as unknown[]) {
      if (
        typeof record !== "object" ||
        record === null ||
        !("type" in record) ||
        typeof record.type !== "string"
      )
        return null;
      if (record.type.includes("error")) errorCount += 1;
      if (record.type === "pcb_autorouting_error") routingFailed = true;
      if (
        /^(pcb_|schematic_|system_block_|simulation_)/.test(record.type) &&
        !record.type.includes("error")
      )
        drawable = true;
    }
    const bytes = new TextEncoder().encode(text).length;
    return bytes <= MAX_HISTORY_BYTES ? { drawable, errorCount, routingFailed, bytes } : null;
  } catch {
    return null;
  }
}

function retain(history: ReadonlyArray<CircuitPlaybackStep>, step: CircuitPlaybackStep) {
  if (history.some(({ id }) => id === step.id)) return history;
  const next = [...history, step].slice(-MAX_STEPS);
  let bytes = next.reduce((total, item) => total + item.bytes, 0);
  let snapshots = next.filter((item) => item.snapshot !== null).length;
  for (
    let i = 0;
    i < next.length && (bytes > MAX_HISTORY_BYTES || snapshots > MAX_SNAPSHOTS);
    i += 1
  ) {
    const item = next[i]!;
    if (item.snapshot === null) continue;
    bytes -= item.bytes;
    snapshots -= 1;
    next[i] = { ...item, snapshot: null, snapshotEvicted: true, bytes: 0 };
  }
  return next;
}

export function recordCircuitPreviewEvent(
  history: ReadonlyArray<CircuitPlaybackStep>,
  event: CircuitPreviewEvent,
) {
  const inspected = inspectCircuitSnapshot(event.circuitJsonText);
  const errors = `${inspected?.errorCount ?? 0} error record${inspected?.errorCount === 1 ? "" : "s"}`;
  const label =
    event.stage === "started"
      ? "Preview started"
      : event.stage === "routing"
        ? `${event.reroute ? "Rerouting" : "Routing"} ${event.phaseStatus === "error" ? "failed" : event.phaseStatus === "complete" ? "finished" : "started"}`
        : event.stage === "checks"
          ? `${event.checks?.map((check) => ({ source: "Source design-rule", placement: "PCB placement", pcb: "PCB design-rule" })[check]).join(" / ") ?? "Design-rule"} checks started`
          : event.stage === "failed"
            ? "Preview failed"
            : inspected === null
              ? "Preview finished"
              : `${inspected.routingFailed ? "Routing failed" : "Preview finished"} · ${errors}`;
  return retain(history, {
    id: `${event.previewId}:${event.sequence}`,
    at: event.observedAt,
    label,
    snapshot: inspected?.drawable ? event.circuitJsonText! : null,
    bytes: inspected?.drawable ? inspected.bytes : 0,
  });
}

export function recordBuildSnapshot(
  history: ReadonlyArray<CircuitPlaybackStep>,
  text: string,
  at: number,
) {
  const inspected = inspectCircuitSnapshot(text);
  if (!inspected?.drawable || history.findLast((step) => step.snapshot !== null)?.snapshot === text)
    return history;
  return retain(history, {
    id: `build:${at}:${history.length}`,
    at,
    label: `Build snapshot · ${inspected.errorCount} error records`,
    snapshot: text,
    bytes: inspected.bytes,
  });
}

export function findSnapshotStep(history: ReadonlyArray<CircuitPlaybackStep>, id: string) {
  const index = history.findIndex((step) => step.id === id);
  if (index < 0) return null;
  if (history[index]?.archivePath !== undefined) return history[index]!;
  // An undated disk file cannot establish which artifact preceded a failed preview.
  return (
    history
      .slice(0, index + 1)
      .findLast(
        (step) => step.snapshot !== null || (step.archivePath !== undefined && step.at !== null),
      ) ?? null
  );
}
