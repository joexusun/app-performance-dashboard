import { describe, expect, it } from "vitest";
import {
  parseRetentionBatchReports,
  parseRetentionCurveReports,
  parseRetentionReport,
  retentionCohortDates
} from "@/lib/server/googleAnalytics";

describe("Google Analytics retention", () => {
  it("uses ten daily cohorts mature for the requested retention day", () => {
    expect(retentionCohortDates(0, new Date("2026-06-09T19:00:00.000Z")).at(-1)).toBe("2026-06-08");
    expect(retentionCohortDates(14, new Date("2026-06-09T19:00:00.000Z"))).toEqual([
      "2026-05-17",
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
      "2026-05-22",
      "2026-05-23",
      "2026-05-24",
      "2026-05-25",
      "2026-05-26"
    ]);
    expect(retentionCohortDates(1, new Date("2026-06-09T19:00:00.000Z"))).toEqual([
      "2026-05-30",
      "2026-05-31",
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
      "2026-06-08"
    ]);
  });

  it("parses D1, D3, D7, and D14 as percentages", () => {
    expect(
      parseRetentionReport([
        { dimensionValues: [{ value: "mature20260525" }, { value: "0001" }], metricValues: [{ value: "10" }, { value: "40" }] },
        { dimensionValues: [{ value: "mature20260526" }, { value: "0001" }], metricValues: [{ value: "15" }, { value: "60" }] },
        { dimensionValues: [{ value: "mature20260525" }, { value: "0003" }], metricValues: [{ value: "18" }, { value: "100" }] },
        { dimensionValues: [{ value: "mature20260525" }, { value: "0007" }], metricValues: [{ value: "12" }, { value: "100" }] },
        { dimensionValues: [{ value: "mature20260525" }, { value: "0014" }], metricValues: [{ value: "7" }, { value: "100" }] }
      ])
    ).toEqual({
      d1: 25,
      d3: 18,
      d7: 12,
      d14: 7
    });
  });

  it("leaves missing or zero-population rows unavailable", () => {
    expect(
      parseRetentionReport([
        { dimensionValues: [{ value: "mature20260526" }, { value: "0001" }], metricValues: [{ value: "0" }, { value: "0" }] }
      ])
    ).toEqual({
      d1: null,
      d3: null,
      d7: null,
      d14: null
    });
  });

  it("selects each retention day from its matching batch report", () => {
    const row = (day: string, active: string, total: string) => ({
      dimensionValues: [{ value: "cohort" }, { value: day }],
      metricValues: [{ value: active }, { value: total }]
    });

    expect(
      parseRetentionBatchReports([
        { rows: [row("0001", "5", "10")] },
        { rows: [row("0003", "4", "10")] },
        { rows: [row("0007", "3", "10")] },
        { rows: [row("0014", "2", "10")] }
      ])
    ).toEqual({
      d1: 50,
      d3: 40,
      d7: 30,
      d14: 20
    });
  });

  it("builds a day 0-30 curve and counts missing active rows as zero retention", () => {
    const row = (cohort: string, day: string, active: string, total: string) => ({
      dimensionValues: [{ value: cohort }, { value: day }],
      metricValues: [{ value: active }, { value: total }]
    });
    const reports = Array.from({ length: 31 }, () => ({ rows: [] as ReturnType<typeof row>[] }));
    reports[0] = {
      rows: [row("a", "0000", "10", "10"), row("b", "0000", "10", "10")]
    };
    reports[1] = {
      rows: [
        row("a", "0000", "10", "10"),
        row("b", "0000", "10", "10"),
        row("a", "0001", "5", "10")
      ]
    };

    const curve = parseRetentionCurveReports(reports);
    expect(curve).toHaveLength(31);
    expect(curve[0]).toEqual({ day: 0, percentage: 100 });
    expect(curve[1]).toEqual({ day: 1, percentage: 25 });
    expect(curve[30]).toEqual({ day: 30, percentage: null });
  });
});
