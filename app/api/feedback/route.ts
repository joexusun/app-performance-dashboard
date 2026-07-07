import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { feedbackAppDisplayName, isFeedbackAppKey, listFeedback, updateFeedbackStatus } from "@/lib/server/feedback";
import type { FeedbackStatus } from "@/lib/shared/types";

const DEFAULT_APP_KEY = "receipt-cam";

export async function GET(request: Request) {
  if (!(await requireAuth())) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const appParam = new URL(request.url).searchParams.get("app") ?? DEFAULT_APP_KEY;
  if (!isFeedbackAppKey(appParam)) {
    return NextResponse.json({ message: `Unknown app "${appParam}"`, items: [] }, { status: 400 });
  }

  let items;
  try {
    items = await listFeedback(appParam);
  } catch {
    return NextResponse.json(
      {
        message: `Could not read ${feedbackAppDisplayName(appParam)} feedback — check the service account's access to the feedback project.`,
        items: []
      },
      { status: 200 }
    );
  }
  if (items === null) {
    return NextResponse.json(
      { message: `${feedbackAppDisplayName(appParam)} Firebase credentials are missing.`, items: [] },
      { status: 200 }
    );
  }
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  if (!(await requireAuth())) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: string; status?: FeedbackStatus; app?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const appKey = body.app ?? DEFAULT_APP_KEY;
  if (!isFeedbackAppKey(appKey)) {
    return NextResponse.json({ message: `Unknown app "${appKey}"` }, { status: 400 });
  }
  if (!body.id || !body.status) {
    return NextResponse.json({ message: "id and status are required" }, { status: 400 });
  }

  const ok = await updateFeedbackStatus(appKey, body.id, body.status);
  if (!ok) {
    return NextResponse.json({ message: "Update failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
