import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  RecaptchaVerifier,
  setPersistence,
  signInWithPhoneNumber,
  type ConfirmationResult,
  type Auth
} from "firebase/auth";

const CLIENT_APP_NAME = "dashboard-client";
let currentVerifier: RecaptchaVerifier | null = null;

function requiredEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function dashboardAuth(): Auth {
  const app =
    getApps().find((candidate) => candidate.name === CLIENT_APP_NAME) ??
    initializeApp(
      {
        apiKey: requiredEnv("NEXT_PUBLIC_DASHBOARD_FIREBASE_API_KEY", process.env.NEXT_PUBLIC_DASHBOARD_FIREBASE_API_KEY),
        authDomain: requiredEnv("NEXT_PUBLIC_DASHBOARD_FIREBASE_AUTH_DOMAIN", process.env.NEXT_PUBLIC_DASHBOARD_FIREBASE_AUTH_DOMAIN),
        projectId: requiredEnv("NEXT_PUBLIC_DASHBOARD_FIREBASE_PROJECT_ID", process.env.NEXT_PUBLIC_DASHBOARD_FIREBASE_PROJECT_ID),
        appId: requiredEnv("NEXT_PUBLIC_DASHBOARD_FIREBASE_APP_ID", process.env.NEXT_PUBLIC_DASHBOARD_FIREBASE_APP_ID)
      },
      CLIENT_APP_NAME
    );

  return getAuth(app.name === CLIENT_APP_NAME ? app : getApp(CLIENT_APP_NAME));
}

export async function sendDashboardLoginCode(phoneNumber: string, containerId: string): Promise<ConfirmationResult> {
  const auth = dashboardAuth();
  await setPersistence(auth, browserLocalPersistence);
  clearDashboardLoginVerifier();
  currentVerifier = new RecaptchaVerifier(auth, containerId, { size: "normal" });
  return signInWithPhoneNumber(auth, phoneNumber, currentVerifier);
}

export function clearDashboardLoginVerifier(): void {
  currentVerifier?.clear();
  currentVerifier = null;
}
