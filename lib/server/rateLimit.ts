// Simple in-memory login throttle keyed by client IP. Suitable for a single
// App Service instance; use a shared store (Redis) if you scale out.

type Attempt = { count: number; firstAt: number; lockedUntil: number };

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

const attempts = new Map<string, Attempt>();

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function checkLoginAllowed(key: string): RateLimitResult {
  const now = Date.now();
  const record = attempts.get(key);
  if (record && record.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function registerFailedLogin(key: string): void {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || now - record.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  record.count += 1;
  if (record.count >= MAX_FAILURES) {
    record.lockedUntil = now + LOCKOUT_MS;
  }
}

export function registerSuccessfulLogin(key: string): void {
  attempts.delete(key);
}
