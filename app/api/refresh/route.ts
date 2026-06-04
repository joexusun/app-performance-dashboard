import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { refreshMetrics } from "@/lib/server/metricsService";

export async function POST() {
  if (!(await requireAuth())) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await refreshMetrics());
}
