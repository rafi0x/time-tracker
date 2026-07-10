import { NextRequest, NextResponse } from "next/server";
import { adjustTaskTime, deleteTask, updateTask } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const taskId = Number(id);
  const body = await req.json();

  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const project = typeof body.project === "string" ? body.project.trim() : undefined;
  const category = typeof body.category === "string" ? body.category.trim() : undefined;
  const totalMs = typeof body.totalMs === "number" && Number.isFinite(body.totalMs)
    ? body.totalMs
    : undefined;

  if (name === undefined && project === undefined && category === undefined && totalMs === undefined) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  if (name !== undefined && !name) {
    return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
  }
  updateTask(taskId, { name, project, category });
  if (totalMs !== undefined) {
    if (totalMs < 0) {
      return NextResponse.json({ error: "totalMs must be >= 0" }, { status: 400 });
    }
    adjustTaskTime(taskId, totalMs);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  deleteTask(Number(id));
  return NextResponse.json({ ok: true });
}
