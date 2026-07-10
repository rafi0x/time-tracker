import { NextRequest, NextResponse } from "next/server";
import { addOption, listOptions, removeOption, type OptionKind } from "@/lib/db";

export const dynamic = "force-dynamic";

function parseKind(raw: unknown): OptionKind | null {
  return raw === "project" || raw === "category" ? raw : null;
}

export function GET() {
  return NextResponse.json({
    project: listOptions("project"),
    category: listOptions("category"),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const kind = parseKind(body.kind);
  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!kind) return NextResponse.json({ error: "kind must be project or category" }, { status: 400 });
  if (!value) return NextResponse.json({ error: "value is required" }, { status: 400 });
  addOption(kind, value);
  return NextResponse.json({ values: listOptions(kind) }, { status: 201 });
}

export function DELETE(req: NextRequest) {
  const kind = parseKind(req.nextUrl.searchParams.get("kind"));
  const value = req.nextUrl.searchParams.get("value") ?? "";
  if (!kind) return NextResponse.json({ error: "kind must be project or category" }, { status: 400 });
  if (!value) return NextResponse.json({ error: "value is required" }, { status: 400 });
  removeOption(kind, value);
  return NextResponse.json({ values: listOptions(kind) });
}
