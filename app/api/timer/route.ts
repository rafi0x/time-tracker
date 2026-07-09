import { NextRequest, NextResponse } from "next/server";
import { getTimerState, startTimer, stopTimer } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getTimerState());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const action = body.action as string;

  if (action === "start" || action === "resume") {
    const taskId = Number(body.taskId);
    if (!Number.isInteger(taskId)) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }
    return NextResponse.json(startTimer(taskId));
  }
  if (action === "pause" || action === "stop") {
    return NextResponse.json(stopTimer());
  }
  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}
