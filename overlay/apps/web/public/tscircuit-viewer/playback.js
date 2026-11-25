// This adapter observes the bundled eval worker; history itself is always JSON-mode viewing.
(() => {
  const requestFile = ".tscircuit-desktop/playback-request";
  const limit = 20 * 1024 * 1024;
  const tapped = new WeakSet();
  self.tscircuitDesktopTapPlayback = (worker) => {
    if (tapped.has(worker)) return;
    const { on, executeWithFsMap, renderUntilSettled, getCircuitJson } = worker;
    if (
      ![on, executeWithFsMap, renderUntilSettled, getCircuitJson].every(
        (fn) => typeof fn === "function",
      )
    )
      return;
    tapped.add(worker);
    let current = null;
    const emit = (run, stage, detail = {}) => {
      if (current !== run) return;
      window.parent.postMessage(
        {
          tscircuit_desktop_type: "playback_observation",
          observation: {
            requestId: run.id,
            sequence: run.sequence++,
            at: Date.now(),
            stage,
            ...detail,
          },
        },
        "*",
      );
    };
    const finish = async (run, stage, readSnapshot = true) => {
      if (!run || run.finished) return;
      run.finished = true;
      let text;
      try {
        const json = readSnapshot ? await getCircuitJson() : null;
        if (Array.isArray(json)) {
          const candidate = JSON.stringify(json);
          if (candidate.length <= limit) text = candidate;
        }
      } catch {
        /* A compilation failure may have no circuit at all. */
      }
      emit(run, stage, {
        checks: [...run.checks],
        ...(text === undefined ? {} : { circuitJsonText: text }),
      });
    };
    worker.on = (name, listener) =>
      on(name, (event) => {
        if (
          current &&
          ["autorouting:start", "autorouting:end", "autorouting:error"].includes(name)
        ) {
          emit(current, "routing", {
            phaseStatus:
              name === "autorouting:start"
                ? "running"
                : name === "autorouting:end"
                  ? "complete"
                  : "error",
            ...(event?.isReroutePhase === true ? { reroute: true } : {}),
          });
        }
        const check =
          name === "board:renderPhaseStarted"
            ? {
                SourceDesignRuleChecks: "source",
                PcbPlacementDesignRuleChecks: "placement",
                PcbDesignRuleChecks: "pcb",
              }[event?.phase]
            : undefined;
        if (current && check && !current.checks.has(check)) {
          current.checks.add(check);
          emit(current, "checks", { checks: [check] });
        }
        return listener(event);
      });
    worker.executeWithFsMap = async (...args) => {
      const id = args[0]?.fsMap?.[requestFile];
      const run =
        typeof id === "string" ? { id, sequence: 0, finished: false, checks: new Set() } : null;
      current = run;
      if (run) emit(run, "started");
      try {
        return await executeWithFsMap(...args);
      } catch (error) {
        void finish(run, "failed", false);
        throw error;
      }
    };
    worker.renderUntilSettled = (...args) => {
      const run = current;
      const pending = renderUntilSettled(...args);
      Promise.resolve(pending).then(
        () => {
          void finish(run, "completed");
        },
        () => {
          void finish(run, "failed");
        },
      );
      return pending;
    };
  };
})();
