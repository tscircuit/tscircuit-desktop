import { fileAttachmentTooLargeMessage } from "@t3tools/client-runtime/state/attachments";
import { FileTextIcon, UploadIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";

export interface AddChipRequest {
  readonly name: string;
  readonly datasheetUrl: string;
  readonly datasheet: File | null;
  readonly spice: boolean;
}

export function buildAddChipPrompt({
  name,
  datasheetUrl,
  datasheet,
  spice,
}: AddChipRequest): string {
  return [
    name
      ? `Add the chip ${name} as a reusable tscircuit component in this project.`
      : "Add the chip described in the supplied datasheet as a reusable tscircuit component in this project.",
    ...(datasheet ? ["Use the attached datasheet to verify the part and package."] : []),
    ...(datasheetUrl ? [`Use this datasheet to verify the part and package: ${datasheetUrl}`] : []),
    ...(!datasheet && !datasheetUrl
      ? [
          "Find the manufacturer's datasheet for this part and use it to verify the part and package.",
        ]
      : []),
    "Create the schematic symbol, PCB footprint, and pin mapping. Follow the project's component conventions and verify the result against the datasheet. Limit project edits to the reusable component and its support files.",
    ...(spice
      ? [
          "Include a SPICE model. Prefer a manufacturer model when one is available. Use a documented reference circuit to check the model where practical. Keep any validation harness temporary and report its results in chat.",
        ]
      : []),
  ].join("\n\n");
}

function isDatasheetUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) && URL.canParse(value);
}

export function AddChipDialog({
  fileLimit,
  onClose,
  onAdd,
}: {
  readonly fileLimit: number | null;
  readonly onClose: () => void;
  readonly onAdd: (request: AddChipRequest) => Promise<string | null>;
}) {
  const nameId = useId();
  const datasheetUrlId = useId();
  const spiceHintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [datasheetUrl, setDatasheetUrl] = useState("");
  const [urlTouched, setUrlTouched] = useState(false);
  const [datasheet, setDatasheet] = useState<File | null>(null);
  const [spice, setSpice] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const canUpload = fileLimit !== null && !submitting;
  const trimmedUrl = datasheetUrl.trim();
  const invalidUrl = trimmedUrl !== "" && !isDatasheetUrl(trimmedUrl);
  const showUrlError = urlTouched && invalidUrl;
  const canAdd = !invalidUrl && (name.trim() !== "" || trimmedUrl !== "" || datasheet !== null);

  const selectFile = (files: FileList | null) => {
    const file = files?.[0];
    if (submitting || fileLimit === null || !file) return;
    if (files.length !== 1 || !/\.pdf$/i.test(file.name)) {
      setFileError("Choose one PDF datasheet.");
    } else if (file.size === 0) {
      setFileError("This PDF is empty.");
    } else if (file.size > fileLimit) {
      setFileError(fileAttachmentTooLargeMessage(file.name, fileLimit));
    } else {
      setDatasheet(file);
      setFileError(null);
      setSubmitError(null);
    }
  };

  const submit = async () => {
    if (!canAdd || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const error = await onAdd({
      name: name.trim(),
      datasheetUrl: trimmedUrl,
      datasheet,
      spice,
    }).catch(() => "Could not send the chip request. Try again.");
    setSubmitting(false);
    setSubmitError(error);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-md" showCloseButton={!submitting}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add chip</DialogTitle>
            <DialogDescription>Provide a chip name, a datasheet URL, or a PDF.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-1.5">
              <Label htmlFor={nameId}>
                Name <span className="text-xs font-normal text-muted-foreground">Optional</span>
              </Label>
              <Input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. LM358B"
                maxLength={160}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={datasheetUrlId}>
                Datasheet URL{" "}
                <span className="text-xs font-normal text-muted-foreground">Optional</span>
              </Label>
              <Input
                id={datasheetUrlId}
                type="url"
                value={datasheetUrl}
                onChange={(event) => setDatasheetUrl(event.target.value)}
                onBlur={() => setUrlTouched(true)}
                placeholder="https://"
                disabled={submitting}
                aria-invalid={showUrlError || undefined}
                aria-describedby={showUrlError ? `${datasheetUrlId}-error` : undefined}
              />
              {showUrlError ? (
                <p id={`${datasheetUrlId}-error`} className="text-sm text-destructive">
                  Enter a valid URL starting with https:// or http://.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <div
                className={cn(
                  "overflow-hidden rounded-xl border border-dashed transition-colors",
                  canUpload && isDropTarget
                    ? "border-ring bg-accent/20"
                    : "border-border/80 bg-muted/20",
                )}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes("Files")) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = canUpload ? "copy" : "none";
                  setIsDropTarget(canUpload);
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setIsDropTarget(false);
                }}
                onDrop={(event) => {
                  if (!event.dataTransfer.types.includes("Files")) return;
                  event.preventDefault();
                  setIsDropTarget(false);
                  selectFile(event.dataTransfer.files);
                }}
              >
                <input
                  ref={input}
                  type="file"
                  accept=".pdf,application/pdf"
                  hidden
                  onChange={(event) => {
                    selectFile(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
                {datasheet ? (
                  <div className="flex min-h-24 min-w-0 items-center gap-2 p-3">
                    <FileTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 wrap-anywhere text-sm">{datasheet.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={submitting}
                      onClick={() => {
                        setDatasheet(null);
                        setFileError(null);
                        setSubmitError(null);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    className="min-h-24 w-full active:scale-100"
                    disabled={!canUpload}
                    onClick={() => input.current?.click()}
                  >
                    <UploadIcon />
                    Upload datasheet
                  </Button>
                )}
              </div>
              {fileLimit === null && !datasheet ? (
                <p className="text-sm text-muted-foreground">
                  PDF uploads are unavailable on this connection.
                </p>
              ) : null}
              {fileError ? (
                <p role="alert" className="text-sm text-destructive">
                  {fileError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <label className="flex w-fit cursor-pointer items-center gap-2 has-disabled:cursor-not-allowed">
                <Checkbox
                  checked={spice}
                  disabled={submitting}
                  onCheckedChange={(checked) => setSpice(checked === true)}
                  aria-describedby={spiceHintId}
                />
                Generate SPICE model
              </label>
              <span id={spiceHintId} className="text-xs text-muted-foreground">
                May take longer
              </span>
            </div>
            {submitError ? (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={submitting}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={!canAdd || submitting}>
              {submitting ? "Sending…" : "Add chip"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
