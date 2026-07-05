import { getDb, getAdminApp } from "@/lib/server/firebaseAdmin";
import { getDashboardConfig } from "@/lib/server/config";
import { getStorage } from "firebase-admin/storage";
import type { FeedbackItem, FeedbackStatus } from "@/lib/shared/types";

const FEEDBACK_APP_KEY = "receipt-cam";
const FEEDBACK_COLLECTION = "feedback";
const LIST_LIMIT = 200;

function getReceiptCamCredentials() {
  const config = getDashboardConfig();
  const app = config.apps.find((candidate) => candidate.key === FEEDBACK_APP_KEY);
  if (!app?.firebase) return null;
  return app.firebase;
}

export async function listFeedback(): Promise<FeedbackItem[] | null> {
  const credentials = getReceiptCamCredentials();
  if (!credentials) return null;

  const db = getDb(`source-${FEEDBACK_APP_KEY}`, credentials);
  const snapshot = await db
    .collection(FEEDBACK_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(LIST_LIMIT)
    .get();

  const items: FeedbackItem[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const createdAt = data.createdAt?.toDate?.() ?? null;

    let attachmentUrl: string | null = null;
    const attachmentPath = typeof data.attachmentPath === "string" ? data.attachmentPath : null;
    if (attachmentPath) {
      try {
        const bucket = getStorage(getAdminApp(`source-${FEEDBACK_APP_KEY}`, credentials)).bucket(
          `${credentials.projectId}.firebasestorage.app`
        );
        const [url] = await bucket.file(attachmentPath).getSignedUrl({
          action: "read",
          expires: Date.now() + 60 * 60 * 1000
        });
        attachmentUrl = url;
      } catch {
        attachmentUrl = null;
      }
    }

    items.push({
      id: doc.id,
      uid: typeof data.uid === "string" ? data.uid : "",
      type: data.type === "bug" || data.type === "idea" || data.type === "question" ? data.type : "question",
      message: typeof data.message === "string" ? data.message : "",
      contactEmail: typeof data.contactEmail === "string" && data.contactEmail ? data.contactEmail : null,
      isAnonymousUser: data.isAnonymousUser === true,
      isPro: data.isPro === true,
      appVersion: typeof data.appVersion === "string" ? data.appVersion : null,
      osVersion: data.osVersion != null ? String(data.osVersion) : null,
      status: data.status === "replied" || data.status === "closed" ? data.status : "new",
      createdAt: createdAt ? createdAt.toISOString() : null,
      attachmentUrl
    });
  }
  return items;
}

export async function updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<boolean> {
  const credentials = getReceiptCamCredentials();
  if (!credentials) return false;
  if (!id || !["new", "replied", "closed"].includes(status)) return false;

  const db = getDb(`source-${FEEDBACK_APP_KEY}`, credentials);
  await db.collection(FEEDBACK_COLLECTION).doc(id).update({
    status,
    statusUpdatedAt: new Date()
  });
  return true;
}
