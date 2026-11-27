import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useStableCallback } from "~/hooks/useStableCallback";
import { Button } from "~/components/ui/button";
import type { SavedCircuitBuild } from "./savedCircuitBuild";

export function CircuitPlaybackControls(props: {
  readonly steps: ReadonlyArray<SavedCircuitBuild>;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly visible: boolean;
  readonly loading: boolean;
}) {
  const { visible, selectedId, loading } = props;
  const onSelect = useStableCallback(props.onSelect);
  const [playing, setPlaying] = useState(false);
  const index = props.steps.findIndex((step) => step.id === props.selectedId);
  const position = index < 0 ? props.steps.length : index;
  const nextId = props.steps[position + 1]?.id;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- advances the discrete playhead on a timer while the visible panel is playing
  useEffect(() => {
    if (!playing || !visible || loading || selectedId === null || index < 0) return;
    const timer = window.setTimeout(() => {
      if (nextId === undefined) setPlaying(false);
      else onSelect(nextId);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [playing, visible, loading, selectedId, index, nextId, onSelect]);
  if (props.steps.length === 0) return null;
  const selected = props.steps[index];
  const time = selected?.at != null ? new Date(selected.at).toLocaleString() : null;
  const description = selected
    ? `${selected.label}${time === null ? "" : ` · ${time}`}`
    : props.selectedId === null
      ? "Live"
      : "Saved build unavailable";
  const playLabel = selectedId === null ? "Play" : nextId === undefined ? "Replay" : "Resume";
  const seek = (next: number) => {
    setPlaying(false);
    props.onSelect(props.steps[next]?.id ?? null);
  };
  return (
    <div
      role="group"
      aria-label="Build history"
      className="flex shrink-0 flex-col gap-1 border-t px-2 py-2 text-xs"
    >
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant="ghost"
          aria-label={`${playing ? "Pause" : playLabel} playback`}
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              if (index < 0 || nextId === undefined) props.onSelect(props.steps[0]!.id);
              setPlaying(true);
            }
          }}
        >
          {playing ? <Pause /> : <Play />}
          {playing ? "Pause" : playLabel}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Previous build"
          disabled={position === 0}
          onClick={() => seek(position - 1)}
        >
          <ChevronLeft />
        </Button>
        <input
          type="range"
          className="min-w-12 flex-1 accent-primary"
          aria-label="Build timeline"
          aria-valuetext={description}
          min={0}
          max={props.steps.length}
          step={1}
          value={position}
          onChange={(event) => seek(event.currentTarget.valueAsNumber)}
        />
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Next build"
          disabled={position === props.steps.length}
          onClick={() => seek(position + 1)}
        >
          <ChevronRight />
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={props.selectedId === null}
          onClick={() => seek(props.steps.length)}
        >
          Back to live
        </Button>
      </div>
      <select
        aria-label="Saved build"
        className="w-full min-w-0 rounded border border-input bg-background px-1 py-1"
        value={selectedId ?? "live"}
        onChange={(event) => {
          setPlaying(false);
          onSelect(event.currentTarget.value === "live" ? null : event.currentTarget.value);
        }}
      >
        {selectedId !== null && index < 0 ? (
          <option value={selectedId}>Saved build unavailable</option>
        ) : null}
        {props.steps.map((step) => (
          <option key={step.id} value={step.id}>
            {step.at === null ? "" : `${new Date(step.at).toLocaleString()} · `}
            {step.label}
          </option>
        ))}
        <option value="live">Live</option>
      </select>
      <span aria-live="polite" className="text-muted-foreground">
        {description}
      </span>
      <span className="text-muted-foreground">
        {props.steps.length} saved {props.steps.length === 1 ? "build" : "builds"} · seeking is
        read-only
      </span>
    </div>
  );
}
