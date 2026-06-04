import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { FirebaseCredentials } from "@/lib/server/config";

function appName(name: string, projectId: string): string {
  return `${name}-${projectId}`;
}

export function getAdminApp(name: string, credentials: FirebaseCredentials): App {
  const resolvedName = appName(name, credentials.projectId);
  const existing = getApps().find((app) => app.name === resolvedName);
  if (existing) return existing;

  try {
    return getApp(resolvedName);
  } catch {
    return initializeApp(
      {
        credential: cert({
          projectId: credentials.projectId,
          clientEmail: credentials.clientEmail,
          privateKey: credentials.privateKey
        })
      },
      resolvedName
    );
  }
}

export function getDb(name: string, credentials: FirebaseCredentials): Firestore {
  return getFirestore(getAdminApp(name, credentials));
}
