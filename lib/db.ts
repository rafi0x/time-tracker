import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Task {
  id: number;
  name: string;
  day: string;
  created_at: number;
  total_ms: number;
  running: boolean;
}

export interface TimerState {
  running: boolean;
  taskId: number | null;
  taskName: string | null;
  day: string | null;
  elapsedMs: number; // elapsed of the running entry's task (total for the task)
  startedAt: number | null;
}

function dataDir(): string {
  const home = homedir();
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "time-tracker");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "time-tracker");
  }
  return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "time-tracker");
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(join(dir, "time-tracker.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      day TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      started_at INTEGER NOT NULL,
      stopped_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_day ON tasks(day);
    CREATE INDEX IF NOT EXISTS idx_entries_task ON time_entries(task_id);
  `);
  return db;
}

export function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function listTasks(day: string): Task[] {
  const now = Date.now();
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.name, t.day, t.created_at,
              COALESCE(SUM(COALESCE(e.stopped_at, ?) - e.started_at), 0) AS total_ms,
              MAX(CASE WHEN e.id IS NOT NULL AND e.stopped_at IS NULL THEN 1 ELSE 0 END) AS running
       FROM tasks t
       LEFT JOIN time_entries e ON e.task_id = t.id
       WHERE t.day = ?
       GROUP BY t.id
       ORDER BY t.created_at ASC`,
    )
    .all(now, day) as unknown as (Omit<Task, "running"> & { running: number })[];
  return rows.map((r) => ({ ...r, total_ms: Number(r.total_ms), running: !!r.running }));
}

export function createTask(name: string, day: string): Task {
  const res = getDb()
    .prepare("INSERT INTO tasks (name, day, created_at) VALUES (?, ?, ?)")
    .run(name, day, Date.now());
  return {
    id: Number(res.lastInsertRowid),
    name,
    day,
    created_at: Date.now(),
    total_ms: 0,
    running: false,
  };
}

export function renameTask(id: number, name: string): void {
  getDb().prepare("UPDATE tasks SET name = ? WHERE id = ?").run(name, id);
}

/**
 * Set a task's total logged time to targetMs by inserting a correction entry
 * with the needed positive or negative duration. Existing entries are kept
 * untouched so the start/stop history stays intact.
 */
export function adjustTaskTime(id: number, targetMs: number): void {
  const now = Date.now();
  const d = getDb();
  const row = d
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(stopped_at, ?) - started_at), 0) AS total
       FROM time_entries WHERE task_id = ?`,
    )
    .get(now, id) as { total: number };
  const delta = Math.max(0, Math.floor(targetMs)) - Number(row.total);
  if (delta === 0) return;
  d.prepare("INSERT INTO time_entries (task_id, started_at, stopped_at) VALUES (?, ?, ?)").run(
    id,
    now,
    now + delta,
  );
}

export function deleteTask(id: number): void {
  getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

function stopRunningEntries(now: number): void {
  getDb().prepare("UPDATE time_entries SET stopped_at = ? WHERE stopped_at IS NULL").run(now);
}

/** Start (or resume) timing a task. Any other running timer is stopped first. */
export function startTimer(taskId: number): TimerState {
  const now = Date.now();
  const d = getDb();
  stopRunningEntries(now);
  d.prepare("INSERT INTO time_entries (task_id, started_at) VALUES (?, ?)").run(taskId, now);
  return getTimerState();
}

/** Pause/stop the currently running timer (same operation in the data model). */
export function stopTimer(): TimerState {
  stopRunningEntries(Date.now());
  return getTimerState();
}

export function getTimerState(): TimerState {
  const now = Date.now();
  const row = getDb()
    .prepare(
      `SELECT e.task_id, e.started_at, t.name, t.day
       FROM time_entries e JOIN tasks t ON t.id = e.task_id
       WHERE e.stopped_at IS NULL
       ORDER BY e.started_at DESC LIMIT 1`,
    )
    .get() as { task_id: number; started_at: number; name: string; day: string } | undefined;

  if (!row) {
    return { running: false, taskId: null, taskName: null, day: null, elapsedMs: 0, startedAt: null };
  }
  const total = getDb()
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(stopped_at, ?) - started_at), 0) AS total
       FROM time_entries WHERE task_id = ?`,
    )
    .get(now, row.task_id) as { total: number };
  return {
    running: true,
    taskId: row.task_id,
    taskName: row.name,
    day: row.day,
    elapsedMs: Number(total.total),
    startedAt: row.started_at,
  };
}
