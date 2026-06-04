import { describe, expect, it } from "vitest";
import type { DecodedIdToken } from "firebase-admin/auth";
import { isAllowedPhoneNumber, validateDecodedPhoneToken } from "@/lib/server/auth";

function token(overrides: Partial<DecodedIdToken>): DecodedIdToken {
  return {
    aud: "app-performance-dashboard",
    auth_time: 0,
    exp: 0,
    firebase: { identities: {}, sign_in_provider: "phone" },
    iat: 0,
    iss: "https://securetoken.google.com/app-performance-dashboard",
    sub: "uid",
    uid: "uid",
    ...overrides
  } as DecodedIdToken;
}

describe("phone auth validation", () => {
  it("accepts allowlisted phone auth tokens", () => {
    const result = validateDecodedPhoneToken(token({ phone_number: "+15551234567" }), ["+1 555 123 4567"]);

    expect(result.ok).toBe(true);
  });

  it("rejects non-phone auth providers", () => {
    const result = validateDecodedPhoneToken(
      token({ firebase: { identities: {}, sign_in_provider: "password" }, phone_number: "+15551234567" }),
      ["+15551234567"]
    );

    expect(result).toMatchObject({ ok: false, message: "Phone sign-in is required." });
  });

  it("rejects phone numbers outside the allowlist", () => {
    const result = validateDecodedPhoneToken(token({ phone_number: "+15550000000" }), ["+15551234567"]);

    expect(result).toMatchObject({ ok: false, message: "This phone number is not allowed." });
  });

  it("requires at least one allowlisted phone number", () => {
    expect(isAllowedPhoneNumber("+15551234567", [])).toBe(false);
  });
});
