import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Task {
  id: number;
  name: string;
  day: string;
  project: string;
  category: string;
  created_at: number;
  total_ms: number;
  running: boolean;
}

export type OptionKind = "project" | "category";

/** Shipped defaults for the Techzu timesheet form. Seeded once; removable. */
const SEED_OPTIONS: Record<OptionKind, string[]> = {
  project: [
    "Bookland ERP",
    "Builder Alliance",
    "Dr Cool",
    "Hydroflux",
    "NewERP",
    "Prowork",
    "Rina CRM",
    "SME Taskhub",
    "VSB",
    "Worksite Mini ERP",
    "ZuPOS",
  ],
  category: [
    "Meeting (General)",
    "Meeting (Technical)",
    "Development",
    "Code Review",
    "Miscellaneous",
  ],
};

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

function addColumnIfMissing(d: DatabaseSync, table: string, column: string, decl: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

/**
 * Insert the shipped project/category lists exactly once. Guarded by a meta
 * flag rather than INSERT OR IGNORE so that options the user deleted don't
 * come back on the next launch.
 */
function seedOptions(d: DatabaseSync): void {
  const done = d.prepare("SELECT value FROM meta WHERE key = 'options_seeded'").get();
  if (done) return;
  const insert = d.prepare(
    "INSERT OR IGNORE INTO options (kind, value, created_at) VALUES (?, ?, ?)",
  );
  const now = Date.now();
  for (const kind of Object.keys(SEED_OPTIONS) as OptionKind[]) {
    for (const value of SEED_OPTIONS[kind]) insert.run(kind, value, now);
  }
  d.prepare("INSERT INTO meta (key, value) VALUES ('options_seeded', '1')").run();
}

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
    CREATE TABLE IF NOT EXISTS options (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (kind, value)
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_day ON tasks(day);
    CREATE INDEX IF NOT EXISTS idx_entries_task ON time_entries(task_id);
  `);
  // Tasks predating project/category tracking keep them empty.
  addColumnIfMissing(db, "tasks", "project", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "tasks", "category", "TEXT NOT NULL DEFAULT ''");
  seedOptions(db);
  return db;
}

// ---------- project / category options ----------

export function listOptions(kind: OptionKind): string[] {
  const rows = getDb()
    .prepare("SELECT value FROM options WHERE kind = ? ORDER BY value COLLATE NOCASE ASC")
    .all(kind) as unknown as { value: string }[];
  return rows.map((r) => r.value);
}

export function addOption(kind: OptionKind, value: string): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO options (kind, value, created_at) VALUES (?, ?, ?)")
    .run(kind, value, Date.now());
}

/**
 * Options are copied into tasks as plain text, so removing one never touches
 * tasks that already reference it — it only leaves the picker's list.
 */
export function removeOption(kind: OptionKind, value: string): void {
  getDb().prepare("DELETE FROM options WHERE kind = ? AND value = ?").run(kind, value);
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
      `SELECT t.id, t.name, t.day, t.project, t.category, t.created_at,
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

export function createTask(name: string, day: string, project = "", category = ""): Task {
  const created_at = Date.now();
  const res = getDb()
    .prepare(
      "INSERT INTO tasks (name, day, project, category, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(name, day, project, category, created_at);
  // Picking a value that isn't in the list yet is how a new option is born.
  if (project) addOption("project", project);
  if (category) addOption("category", category);
  return {
    id: Number(res.lastInsertRowid),
    name,
    day,
    project,
    category,
    created_at,
    total_ms: 0,
    running: false,
  };
}

export function updateTask(
  id: number,
  fields: { name?: string; project?: string; category?: string },
): void {
  const sets: string[] = [];
  const values: string[] = [];
  for (const key of ["name", "project", "category"] as const) {
    const value = fields[key];
    if (value === undefined) continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (!sets.length) return;
  getDb().prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  if (fields.project) addOption("project", fields.project);
  if (fields.category) addOption("category", fields.category);
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
