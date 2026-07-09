"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatDayLabel,
  formatDuration,
  parseDuration,
  shiftDay,
} from "@/lib/time";

interface Task {
  id: number;
  name: string;
  day: string;
  total_ms: number;
  running: boolean;
}

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Dashboard() {
  const [day, setDay] = useState(localToday);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editTime, setEditTime] = useState("");
  const fetchedAt = useRef(0);
  const [, forceTick] = useState(0);

  const today = localToday();

  const refresh = useCallback(async (d: string) => {
    const res = await fetch(`/api/tasks?day=${d}`);
    const data = await res.json();
    fetchedAt.current = Date.now();
    setTasks(data.tasks);
    setLoaded(true);
  }, []);

  useEffect(() => {
    setLoaded(false);
    refresh(day);
  }, [day, refresh]);

  // Re-render every second so running totals tick; re-fetch every 5s to stay
  // in sync with changes made from the tray panel.
  useEffect(() => {
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    const sync = setInterval(() => refresh(day), 5000);
    return () => {
      clearInterval(tick);
      clearInterval(sync);
    };
  }, [day, refresh]);

  const liveTotal = (t: Task) =>
    t.running ? t.total_ms + (Date.now() - fetchedAt.current) : t.total_ms;

  const runningTask = tasks.find((t) => t.running) ?? null;
  const dayTotal = tasks.reduce((sum, t) => sum + liveTotal(t), 0);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    // Adding a task on today immediately starts its timer.
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, day, start: day === today }),
    });
    refresh(day);
  }

  function beginEdit(t: Task) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditTime(formatDuration(liveTotal(t)));
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (editingId === null) return;
    const name = editName.trim();
    const totalMs = parseDuration(editTime);
    if (!name || totalMs === null) return;
    setEditingId(null);
    await fetch(`/api/tasks/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, totalMs }),
    });
    refresh(day);
  }

  async function timerAction(action: string, taskId?: number) {
    await fetch("/api/timer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, taskId }),
    });
    refresh(day);
  }

  async function removeTask(id: number) {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    refresh(day);
  }

  return (
    <main className="shell">
      <header className="daynav">
        <button
          className="nav-btn"
          aria-label="Previous day"
          onClick={() => setDay(shiftDay(day, -1))}
        >
          ‹
        </button>
        <h1>{formatDayLabel(day, today)}</h1>
        <button
          className="nav-btn"
          aria-label="Next day"
          onClick={() => setDay(shiftDay(day, 1))}
        >
          ›
        </button>
        {day !== today && (
          <button className="today-btn" onClick={() => setDay(today)}>
            Today
          </button>
        )}
        <span className="spacer" />
        <span className="day-total">
          Total: <strong className="mono">{formatDuration(dayTotal)}</strong>
        </span>
      </header>

      <section className={`running-strip${runningTask ? " active" : ""}`}>
        <div className="info">
          <div className="label">
            {runningTask && <span className="pulse-dot" aria-hidden />}
            {runningTask ? "Tracking" : "Not tracking"}
          </div>
          {runningTask ? (
            <div className="task-name">{runningTask.name}</div>
          ) : (
            <div className="idle-hint">
              Press play on a task to start the clock.
            </div>
          )}
        </div>
        <div className="big-time mono">
          {formatDuration(runningTask ? liveTotal(runningTask) : 0)}
        </div>
        {runningTask && (
          <div className="strip-controls">
            <button
              className="ctl-btn primary"
              onClick={() => timerAction("pause")}
            >
              Pause
            </button>
          </div>
        )}
      </section>

      <form className="add-form" onSubmit={addTask}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="What are you working on?"
          aria-label="New task name"
        />
        <button className="ctl-btn primary" type="submit">
          Add task
        </button>
      </form>

      <ul className="task-list">
        {tasks.length === 0 && (
          <li className="empty">
            {loaded
              ? day === today
                ? "No tasks yet. Add one above to start tracking."
                : "No tasks were tracked on this day."
              : "Loading…"}
          </li>
        )}
        {tasks.map((t) => (
          <li key={t.id} className={`task-row${t.running ? " running" : ""}`}>
            {editingId === t.id ? (
              <form className="edit-form" onSubmit={saveEdit}>
                <input
                  className="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label="Task name"
                  autoFocus
                />
                <input
                  className="edit-time mono"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  aria-label="Logged time (HH:MM:SS)"
                  placeholder="00:00:00"
                />
                <button
                  className="ctl-btn primary"
                  type="submit"
                  disabled={
                    !editName.trim() || parseDuration(editTime) === null
                  }
                >
                  Save
                </button>
                <button
                  className="ctl-btn"
                  type="button"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="name">{t.name}</span>
                <span className="time mono">
                  {formatDuration(liveTotal(t))}
                </span>
                <button
                  className="row-btn"
                  aria-label={`Edit ${t.name}`}
                  title="Edit name and time"
                  onClick={() => beginEdit(t)}
                >
                  ✎
                </button>
                {t.running ? (
                  <button
                    className="row-btn"
                    aria-label={`Pause ${t.name}`}
                    title="Pause"
                    onClick={() => timerAction("pause")}
                  >
                    ❚❚
                  </button>
                ) : (
                  <button
                    className="row-btn play"
                    aria-label={`Start ${t.name}`}
                    title="Start"
                    onClick={() => timerAction("start", t.id)}
                  >
                    ▶
                  </button>
                )}
                <button
                  className="row-btn delete"
                  aria-label={`Delete ${t.name}`}
                  title="Delete"
                  onClick={() => removeTask(t.id)}
                >
                  ✕
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

