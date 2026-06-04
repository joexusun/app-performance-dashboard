import { describe, expect, it } from "vitest";
import { createAppStoreJwt, parseSalesReportTsv } from "@/lib/server/appStore";

describe("App Store report parsing", () => {
  it("sums first-time app units for the selected Apple app id", () => {
    const tsv = [
      "Provider\tApple Identifier\tProduct Type Identifier\tUnits",
      "Example\t111\t1F\t3",
      "Example\t111\t3F\t9",
      "Example\t111\t1\t2",
      "Example\t222\t1F\t20"
    ].join("\n");

    expect(parseSalesReportTsv(tsv, "111")).toBe(5);
  });

  it("returns null when JWT credentials are incomplete", () => {
    expect(
      createAppStoreJwt({
        keyId: null,
        issuerId: "issuer",
        privateKey: "key",
        vendorNumber: "vendor"
      })
    ).toBeNull();
  });
});
