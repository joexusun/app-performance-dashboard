import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { extractClientIp, isIpAllowed, parseAllowlist } from "@/lib/shared/ipAllowlist";

const allowlist = parseAllowlist(process.env.DASHBOARD_ALLOWED_IPS);

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return response;
}

export function middleware(request: NextRequest) {
  if (allowlist.length > 0) {
    const clientIp = extractClientIp(request.headers);
    if (!isIpAllowed(clientIp, allowlist)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  // Apply to everything except Next.js internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
