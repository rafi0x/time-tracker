"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/time";

interface TimerState {
  running: boolean;
  taskId: number | null;
  taskName: string | null;
  elapsedMs: number;
}

export default function TrayPanel() {
  const [state, setState] = useState<TimerState | null>(null);
  const fetchedAt = useRef(0);
  const lastTaskId = useRef<number | null>(null);
  const [, forceTick] = useState(0);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/timer");
    const data: TimerState = await res.json();
    fetchedAt.current = Date.now();
    if (data.taskId) lastTaskId.current = data.taskId;
    setState(data);
  }, []);

  useEffect(() => {
    refresh();
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    const sync = setInterval(refresh, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(sync);
    };
  }, [refresh]);

  async function action(a: string, taskId?: number) {
    await fetch("/api/timer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: a, taskId }),
    });
    refresh();
  }

  const elapsed = state?.running
    ? state.elapsedMs + (Date.now() - fetchedAt.current)
    : state?.elapsedMs ?? 0;

  return (
    <main className="panel">
      <div className="task-name">
        {state === null
          ? "…"
          : state.running
            ? state.taskName
            : lastTaskId.current
              ? "Paused"
              : "No timer running"}
      </div>
      <div className={`big-time mono${state?.running ? " active" : ""}`}>
        {formatDuration(elapsed)}
      </div>
      <div className="controls">
        {state?.running ? (
          <button className="ctl-btn primary" onClick={() => action("pause")}>
            Pause
          </button>
        ) : lastTaskId.current ? (
          <button className="ctl-btn primary" onClick={() => action("resume", lastTaskId.current ?? undefined)}>
            Resume
          </button>
        ) : null}
        {state?.running && (
          <button className="ctl-btn" onClick={() => action("stop")}>
            Stop
          </button>
        )}
      </div>
      <a className="open-link" href="/" target="_blank">
        Open Time Tracker
      </a>
    </main>
  );
}
