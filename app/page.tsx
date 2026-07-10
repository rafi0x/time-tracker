"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatDayLabel,
  formatDuration,
  parseDuration,
  shiftDay,
} from "@/lib/time";
import OptionPicker from "./OptionPicker";

interface Task {
  id: number;
  name: string;
  day: string;
  project: string;
  category: string;
  total_ms: number;
  running: boolean;
}

type OptionKind = "project" | "category";
type Options = Record<OptionKind, string[]>;

const LAST_USED_KEY = "time-tracker:last-used";

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** navigator.clipboard is unavailable in some desktop webviews. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

export default function Dashboard() {
  const [day, setDay] = useState(localToday);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [options, setOptions] = useState<Options>({
    project: [],
    category: [],
  });
  const [newName, setNewName] = useState("");
  const [newProject, setNewProject] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editProject, setEditProject] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editTime, setEditTime] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "ok" | "err">("idle");
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

  const refreshOptions = useCallback(async () => {
    const res = await fetch("/api/options");
    setOptions(await res.json());
  }, []);

  useEffect(() => {
    setLoaded(false);
    refresh(day);
  }, [day, refresh]);

  useEffect(() => {
    refreshOptions();
    try {
      const last = JSON.parse(localStorage.getItem(LAST_USED_KEY) ?? "{}");
      if (typeof last.project === "string") setNewProject(last.project);
      if (typeof last.category === "string") setNewCategory(last.category);
    } catch {
      // ignore malformed leftovers
    }
  }, [refreshOptions]);

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

  async function addOption(kind: OptionKind, value: string) {
    setOptions((o) => ({
      ...o,
      [kind]: [...o[kind], value].sort((a, b) => a.localeCompare(b)),
    }));
    await fetch("/api/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, value }),
    });
    refreshOptions();
  }

  async function removeOption(kind: OptionKind, value: string) {
    setOptions((o) => ({ ...o, [kind]: o[kind].filter((v) => v !== value) }));
    await fetch(
      `/api/options?kind=${kind}&value=${encodeURIComponent(value)}`,
      {
        method: "DELETE",
      },
    );
    refreshOptions();
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    localStorage.setItem(
      LAST_USED_KEY,
      JSON.stringify({ project: newProject, category: newCategory }),
    );
    // Adding a task on today immediately starts its timer.
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        day,
        project: newProject,
        category: newCategory,
        start: day === today,
      }),
    });
    refresh(day);
  }

  function beginEdit(t: Task) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditProject(t.project);
    setEditCategory(t.category);
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
      body: JSON.stringify({
        name,
        project: editProject,
        category: editCategory,
        totalMs,
      }),
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

  async function copyDayCsv() {
    // Ask the server to build it: a running task's total is only exact there.
    const csv = await (await fetch(`/api/export?day=${day}`)).text();
    setCopyState((await copyText(csv)) ? "ok" : "err");
    setTimeout(() => setCopyState("idle"), 2000);
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
        <button
          className="copy-btn"
          onClick={copyDayCsv}
          disabled={tasks.length === 0}
          title="Copy this day's activity as CSV for the timesheet extension"
        >
          {copyState === "ok"
            ? "Copied ✓"
            : copyState === "err"
              ? "Copy failed"
              : "Copy"}
        </button>
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
          className="add-name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="What are you working on?"
          aria-label="New task name"
        />
        <div className="add-meta">
          <OptionPicker
            placeholder="Project"
            value={newProject}
            options={options.project}
            onChange={setNewProject}
            onAdd={(v) => addOption("project", v)}
            onRemove={(v) => removeOption("project", v)}
          />
          <OptionPicker
            placeholder="Category"
            value={newCategory}
            options={options.category}
            onChange={setNewCategory}
            onAdd={(v) => addOption("category", v)}
            onRemove={(v) => removeOption("category", v)}
          />
          <button className="ctl-btn primary" type="submit">
            Add task
          </button>
        </div>
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
                <div className="edit-meta">
                  <OptionPicker
                    placeholder="Project"
                    value={editProject}
                    options={options.project}
                    onChange={setEditProject}
                    onAdd={(v) => addOption("project", v)}
                    onRemove={(v) => removeOption("project", v)}
                  />
                  <OptionPicker
                    placeholder="Category"
                    value={editCategory}
                    options={options.category}
                    onChange={setEditCategory}
                    onAdd={(v) => addOption("category", v)}
                    onRemove={(v) => removeOption("category", v)}
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
                </div>
              </form>
            ) : (
              <>
                <div className="cell">
                  <span className="name">{t.name}</span>
                  {(t.project || t.category) && (
                    <span className="badges">
                      {t.project && (
                        <span className="badge project">{t.project}</span>
                      )}
                      {t.category && (
                        <span className="badge category">{t.category}</span>
                      )}
                    </span>
                  )}
                </div>
                <span className="time mono">
                  {formatDuration(liveTotal(t))}
                </span>
                <button
                  className="row-btn"
                  aria-label={`Edit ${t.name}`}
                  title="Edit name, project, category and time"
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

