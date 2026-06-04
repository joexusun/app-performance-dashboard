import { describe, expect, it } from "vitest";
import { appleReportDate, getMetricWindows, ptMidnightUtc } from "@/lib/server/dateWindows";

describe("date windows", () => {
  it("finds the PT midnight that starts today", () => {
    const midnight = ptMidnightUtc(new Date("2026-06-02T20:00:00.000Z"));
    expect(midnight.toISOString()).toBe("2026-06-02T07:00:00.000Z");
  });

  it("builds today, 7 day, and 30 day windows from PT midnight", () => {
    const windows = getMetricWindows(new Date("2026-06-02T20:00:00.000Z"));
    expect(windows.map((window) => window.key)).toEqual(["today", "sevenDays", "thirtyDays"]);
    expect(windows[0].start.toISOString()).toBe("2026-06-02T07:00:00.000Z");
    expect(windows[1].start.toISOString()).toBe("2026-05-27T07:00:00.000Z");
    expect(windows[2].start.toISOString()).toBe("2026-05-04T07:00:00.000Z");
  });

  it("formats Apple report dates in PT", () => {
    expect(appleReportDate(new Date("2026-06-02T04:30:00.000Z"))).toBe("2026-06-01");
  });
});
