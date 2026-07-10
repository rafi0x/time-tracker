import type { Task } from "./db";

export const CSV_HEADER = ["date", "project", "category", "task", "time"] as const;

/** `hh:mm`, the format the timesheet form's "Hours Clocked" field expects. */
export function msToHhMm(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(totalMin / 60))}:${pad(totalMin % 60)}`;
}

function cell(value: string): string {
  return /["\n\r,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC 4180 CSV of a day's activity, one row per task. */
export function tasksToCsv(day: string, tasks: Task[]): string {
  const rows = tasks.map((t) =>
    [day, t.project, t.category, t.name, msToHhMm(t.total_ms)].map(cell).join(","),
  );
  return [CSV_HEADER.join(","), ...rows].join("\n");
}
