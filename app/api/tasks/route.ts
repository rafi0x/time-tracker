import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks, startTimer, todayStr } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const day = req.nextUrl.searchParams.get("day") ?? todayStr();
  return NextResponse.json({ day, tasks: listTasks(day) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const day = typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day)
    ? body.day
    : todayStr();
  const project = typeof body.project === "string" ? body.project.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const task = createTask(name, day, project, category);
  if (body.start) {
    startTimer(task.id);
    task.running = true;
  }
  return NextResponse.json(task, { status: 201 });
}
