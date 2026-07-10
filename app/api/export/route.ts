import { NextRequest, NextResponse } from "next/server";
import { listTasks, todayStr } from "@/lib/db";
import { tasksToCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** A day's activity as CSV, ready to paste into the timesheet extension. */
export function GET(req: NextRequest) {
  const day = req.nextUrl.searchParams.get("day") ?? todayStr();
  return new NextResponse(tasksToCsv(day, listTasks(day)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="timesheet-${day}.csv"`,
    },
  });
}
