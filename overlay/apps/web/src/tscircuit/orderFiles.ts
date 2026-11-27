/**
 * tscircuit desktop: the files a board is ordered with. The viewer frame makes
 * them (public/tscircuit-viewer/frame.html); the app names and saves them.
 */
import { type ElementCounts } from "./circuitViews";
import { isRecord, type OrderRequestKind, type OrderResponsePayload } from "./orderRequest";

export type OrderFileKind = Exclude<OrderRequestKind, "jlcpcb_quote" | "circuithub_project">;

/** What a file is made from: a board outline, or parts placed on one. */
type OrderFileNeed = "board" | "parts";

interface OrderFile {
  readonly kind: OrderFileKind;
  readonly label: string;
  readonly description: string;
  readonly needs: OrderFileNeed;
  /** What follows the project's name in the saved file's name. */
  readonly suffix: string;
  /** A zip holds every file the viewer made; anything else is the one file it made. */
  readonly zipped: boolean;
}

export const ORDER_FILES: ReadonlyArray<OrderFile> = [
  {
    kind: "gerbers",
    label: "Gerbers",
    description: "The board itself: copper, solder mask, silkscreen, outline and drill holes.",
    needs: "board",
    suffix: "-gerbers.zip",
    zipped: true,
  },
  {
    kind: "bom",
    label: "Bill of materials",
    description: "The parts to buy, with JLCPCB part numbers where tscircuit found them.",
    needs: "parts",
    suffix: "-bom.csv",
    zipped: false,
  },
  {
    kind: "pick_and_place",
    label: "Pick and place (CPL)",
    description: "Where each part sits on the board and how it is turned, for the assembly line.",
    needs: "parts",
    suffix: "-pick-and-place.csv",
    zipped: false,
  },
  {
    kind: "kicad_project",
    label: "KiCad project",
    description: "The whole design, for manufacturers that read design files and not Gerbers.",
    needs: "board",
    suffix: "-kicad.zip",
    zipped: true,
  },
];

const has = (counts: ElementCounts, type: string) => (counts[type] ?? 0) > 0;

/** What the rendered circuit has to make files from. */
export function orderFileNeedsMet(counts: ElementCounts): ReadonlySet<OrderFileNeed> {
  const met = new Set<OrderFileNeed>();
  if (has(counts, "pcb_board") || has(counts, "pcb_panel")) met.add("board");
  if (has(counts, "pcb_component")) met.add("parts");
  return met;
}

let lastCounted: { readonly text: string; readonly counts: ElementCounts | null } | null = null;

/**
 * How many elements of each type a build's Circuit JSON has, as the viewer reports them
 * for a run. Null for text that is not Circuit JSON. The last answer is kept: parsing
 * megabytes is not work to repeat on every render.
 */
export function countBuildElements(circuitJsonText: string): ElementCounts | null {
  if (lastCounted?.text === circuitJsonText) return lastCounted.counts;
  let counts: Record<string, number> | null = null;
  try {
    const elements: unknown = JSON.parse(circuitJsonText);
    if (Array.isArray(elements)) {
      counts = {};
      for (const element of elements) {
        if (isRecord(element) && typeof element.type === "string") {
          counts[element.type] = (counts[element.type] ?? 0) + 1;
        }
      }
    }
  } catch {
    counts = null;
  }
  lastCounted = { text: circuitJsonText, counts };
  return counts;
}

const GENERIC_ENTRY_NAMES = new Set(["index", "main", "circuit"]);

const lastSegment = (path: string) =>
  path.split(/[\\/]+/).findLast((segment) => segment !== "") ?? "";

const safeName = (name: string) =>
  name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");

/** Names the saved files after the file ordered, or after the project when that is just "index". */
export function orderProjectName(entryFile: string, cwd: string): string {
  const fileName = safeName(lastSegment(entryFile).replace(/(\.circuit)?\.[jt]sx?$/i, ""));
  if (fileName !== "" && !GENERIC_ENTRY_NAMES.has(fileName.toLowerCase())) return fileName;
  return safeName(lastSegment(cwd)) || fileName || "circuit";
}

export const orderFileName = (file: OrderFile, projectName: string): string =>
  `${projectName}${file.suffix}`;

/** File contents by path, as the viewer frame made them. */
export type OrderFileContents = Readonly<Record<string, string>>;

/** The frame runs project code, so a path it names is not trusted to stay inside a zip. */
const isSafeRelativePath = (path: string): boolean =>
  path.length > 0 &&
  path.length <= 255 &&
  !path.includes("\\") &&
  !path.includes("\0") &&
  path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

/** The files in the viewer's answer. Null when it holds none that can be saved safely. */
export function readOrderFiles(payload: OrderResponsePayload): OrderFileContents | null {
  const files = isRecord(payload.files) ? Object.entries(payload.files) : [];
  const valid = files.every(
    (entry): entry is [string, string] =>
      isSafeRelativePath(entry[0]) && typeof entry[1] === "string",
  );
  return files.length > 0 && valid ? Object.fromEntries(files) : null;
}

/** The one file to save: a zip of everything the viewer made, or the single file it made. */
export async function packOrderFiles(file: OrderFile, contents: OrderFileContents): Promise<Blob> {
  if (!file.zipped) {
    const [text = ""] = Object.values(contents);
    return new Blob([text], { type: "text/csv;charset=utf-8" });
  }
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const [path, text] of Object.entries(contents)) zip.file(path, text);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
