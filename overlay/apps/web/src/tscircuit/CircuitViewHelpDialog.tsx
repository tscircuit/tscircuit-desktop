import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";

/** What the dialog explains: how to give a view something to show, or why nothing rendered. */
export interface CircuitViewHelp {
  readonly title: string;
  readonly description: string;
  /** The example to copy from, or the error that stopped the file. */
  readonly code: string;
  readonly prompt: string;
}

/** Opened from a muted view tab. Null `help` keeps it closed. */
export function CircuitViewHelpDialog(props: {
  readonly help: CircuitViewHelp | null;
  readonly onClose: () => void;
  readonly onAddToPrompt: (prompt: string) => void;
}) {
  const { help } = props;
  return (
    <Dialog
      open={help !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      {help === null ? null : (
        <DialogPopup className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{help.title}</DialogTitle>
            <DialogDescription>{help.description}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <pre className="wrap-anywhere whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
              <code>{help.code}</code>
            </pre>
            <p className="text-muted-foreground text-sm">
              Or ask the agent to do it. This adds to your prompt:{" "}
              <span className="text-foreground">{help.prompt}</span>
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Close
            </Button>
            <Button type="button" onClick={() => props.onAddToPrompt(help.prompt)}>
              Add to prompt
            </Button>
          </DialogFooter>
        </DialogPopup>
      )}
    </Dialog>
  );
}
