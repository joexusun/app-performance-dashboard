import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { readMetrics } from "@/lib/server/metricsService";

export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await readMetrics());
}
