import { describe, expect, it } from "vitest";
import { isAndroidPlatform } from "@/lib/server/firestoreMetrics";

describe("Puzzle Canvas platform filtering", () => {
  it("recognizes Android platform values case-insensitively", () => {
    expect(isAndroidPlatform("android")).toBe(true);
    expect(isAndroidPlatform(" Android ")).toBe(true);
    expect(isAndroidPlatform(undefined, "ANDROID")).toBe(true);
  });

  it("does not classify iOS or missing legacy platform values as Android", () => {
    expect(isAndroidPlatform("ios")).toBe(false);
    expect(isAndroidPlatform(undefined, null)).toBe(false);
  });
});
