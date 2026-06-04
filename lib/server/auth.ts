import { createHmac, timingSafeEqual } from "crypto";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAuth } from "firebase-admin/auth";
import { cookies } from "next/headers";
import { getDashboardConfig } from "@/lib/server/config";
import { getAdminApp } from "@/lib/server/firebaseAdmin";

const COOKIE_NAME = "dashboard_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;
const PHONE_PROVIDER = "phone";

function dashboardBasePath(): string {
  const value = process.env.NEXT_PUBLIC_DASHBOARD_BASE_PATH?.trim();
  if (!value || value === "/") return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function sessionCookiePath(): "/" | string {
  return dashboardBasePath() || "/";
}

export type LoginValidationResult =
  | { ok: true; token: DecodedIdToken }
  | { ok: false; message: string };

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function sessionValue(secret: string): string {
  const payload = JSON.stringify({ role: "admin", issuedAt: Date.now() });
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

function isValidSession(value: string | undefined, secret: string): boolean {
  if (!value) return false;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return false;
  const expected = signature(payload, secret);
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected)) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;

  // Enforce expiry server-side; never trust the browser cookie maxAge alone.
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      role?: string;
      issuedAt?: number;
    };
    if (decoded.role !== "admin") return false;
    if (typeof decoded.issuedAt !== "number") return false;
    return Date.now() - decoded.issuedAt < MAX_AGE_SECONDS * 1000;
  } catch {
    return false;
  }
}

export async function requireAuth(): Promise<boolean> {
  const config = getDashboardConfig();
  const cookieStore = await cookies();
  return isValidSession(cookieStore.get(COOKIE_NAME)?.value, config.authSecret);
}

export async function createSession(): Promise<void> {
  const config = getDashboardConfig();
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, sessionValue(config.authSecret), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
    path: sessionCookiePath()
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: sessionCookiePath()
  });
}

function normalizePhoneNumber(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

export function isAllowedPhoneNumber(phoneNumber: string | undefined, allowedPhoneNumbers: string[]): boolean {
  if (!phoneNumber || allowedPhoneNumbers.length === 0) return false;
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  return allowedPhoneNumbers.map(normalizePhoneNumber).includes(normalizedPhoneNumber);
}

export function validateDecodedPhoneToken(token: DecodedIdToken, allowedPhoneNumbers: string[]): LoginValidationResult {
  const provider = token.firebase?.sign_in_provider;
  if (provider !== PHONE_PROVIDER) {
    return { ok: false, message: "Phone sign-in is required." };
  }

  if (!isAllowedPhoneNumber(token.phone_number, allowedPhoneNumbers)) {
    return { ok: false, message: "This phone number is not allowed." };
  }

  return { ok: true, token };
}

export async function verifyFirebasePhoneToken(idToken: string | undefined): Promise<LoginValidationResult> {
  if (!idToken) {
    return { ok: false, message: "Missing Firebase ID token." };
  }

  const config = getDashboardConfig();
  if (!config.dashboardFirebase) {
    return { ok: false, message: "Dashboard Firebase credentials are missing." };
  }

  if (config.allowedPhoneNumbers.length === 0) {
    return { ok: false, message: "No dashboard phone numbers are allowlisted." };
  }

  try {
    const app = getAdminApp("dashboard-auth", config.dashboardFirebase);
    const token = await getAuth(app).verifyIdToken(idToken, true);
    return validateDecodedPhoneToken(token, config.allowedPhoneNumbers);
  } catch {
    return { ok: false, message: "Invalid Firebase ID token." };
  }
}
