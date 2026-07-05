import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { listFeedback, updateFeedbackStatus } from "@/lib/server/feedback";
import type { FeedbackStatus } from "@/lib/shared/types";

export async function GET() {
  if (!(await requireAuth())) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const items = await listFeedback();
  if (items === null) {
    return NextResponse.json(
      { message: "Receipt Cam Firebase credentials are missing.", items: [] },
      { status: 200 }
    );
  }
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  if (!(await requireAuth())) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: string; status?: FeedbackStatus };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.id || !body.status) {
    return NextResponse.json({ message: "id and status are required" }, { status: 400 });
  }

  const ok = await updateFeedbackStatus(body.id, body.status);
  if (!ok) {
    return NextResponse.json({ message: "Update failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
