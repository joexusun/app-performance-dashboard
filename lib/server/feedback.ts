import { getDb, getAdminApp } from "@/lib/server/firebaseAdmin";
import { getDashboardConfig } from "@/lib/server/config";
import { getStorage } from "firebase-admin/storage";
import type { AppKey, FeedbackItem, FeedbackStatus } from "@/lib/shared/types";

// Apps whose Firestore has (or will have) the shared `feedback` collection schema.
const FEEDBACK_APP_KEYS: AppKey[] = ["receipt-cam", "savory-advisor", "puzzle-canvas"];
const FEEDBACK_COLLECTION = "feedback";
const LIST_LIMIT = 200;

export function isFeedbackAppKey(value: unknown): value is AppKey {
  return typeof value === "string" && (FEEDBACK_APP_KEYS as string[]).includes(value);
}

function getFeedbackCredentials(appKey: AppKey) {
  const config = getDashboardConfig();
  const app = config.apps.find((candidate) => candidate.key === appKey);
  const credentials = app?.feedbackFirebase ?? app?.firebase ?? null;
  if (!credentials) return null;
  // Distinct Admin app name per target project, so a feedback override never
  // reuses the metrics connection to the app's main project (or vice versa).
  return { credentials, instanceName: `feedback-${appKey}-${credentials.projectId}` };
}

export function feedbackAppDisplayName(appKey: AppKey): string {
  const config = getDashboardConfig();
  return config.apps.find((candidate) => candidate.key === appKey)?.displayName ?? appKey;
}

export async function listFeedback(appKey: AppKey): Promise<FeedbackItem[] | null> {
  const source = getFeedbackCredentials(appKey);
  if (!source) return null;
  const { credentials, instanceName } = source;

  const db = getDb(instanceName, credentials);
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
        const bucket = getStorage(getAdminApp(instanceName, credentials)).bucket(
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
      attachmentUrl,
      attachmentName: attachmentPath ? attachmentPath.split("/").pop() ?? null : null
    });
  }
  return items;
}

export async function updateFeedbackStatus(appKey: AppKey, id: string, status: FeedbackStatus): Promise<boolean> {
  const source = getFeedbackCredentials(appKey);
  if (!source) return false;
  if (!id || !["new", "replied", "closed"].includes(status)) return false;

  const db = getDb(source.instanceName, source.credentials);
  await db.collection(FEEDBACK_COLLECTION).doc(id).update({
    status,
    statusUpdatedAt: new Date()
  });
  return true;
}
