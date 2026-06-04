import { NextResponse } from "next/server";
import { createSession, verifyFirebasePhoneToken } from "@/lib/server/auth";
import { checkLoginAllowed, registerFailedLogin, registerSuccessfulLogin } from "@/lib/server/rateLimit";
import { extractClientIp } from "@/lib/shared/ipAllowlist";

export async function POST(request: Request) {
  const clientKey = extractClientIp(request.headers) ?? "unknown";

  const limit = checkLoginAllowed(clientKey);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, message: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const body = (await request.json().catch(() => null)) as { idToken?: string } | null;
  const validation = await verifyFirebasePhoneToken(body?.idToken);

  if (!validation.ok) {
    registerFailedLogin(clientKey);
    return NextResponse.json({ ok: false, message: validation.message }, { status: 401 });
  }

  registerSuccessfulLogin(clientKey);
  await createSession();
  return NextResponse.json({ ok: true });
}
