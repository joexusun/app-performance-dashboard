import { GoogleAuth } from "google-auth-library";
import type { AppConfig } from "@/lib/server/config";
import type { MetricValues, RetentionCurvePoint } from "@/lib/shared/types";
import { ptDateKey, ptMidnightUtc } from "@/lib/server/dateWindows";

const DAY_MS = 24 * 60 * 60 * 1000;
const COHORT_COUNT = 10;
const RETENTION_DAYS = [1, 3, 7, 14] as const;
const RETENTION_CURVE_DAYS = Array.from({ length: 31 }, (_, day) => day);
const MAX_BATCH_REQUESTS = 5;

type RetentionKey = keyof MetricValues["retention"];

type AnalyticsReportRow = {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
};

type AnalyticsReportResponse = {
  rows?: AnalyticsReportRow[];
  error?: {
    message?: string;
  };
};

type AnalyticsBatchResponse = {
  reports?: AnalyticsReportResponse[];
  error?: {
    message?: string;
  };
};

export function retentionCohortDates(retentionDay: number, now = new Date()): string[] {
  const today = ptMidnightUtc(now);
  const maturityDay = Math.max(retentionDay, 1);
  return Array.from({ length: COHORT_COUNT }, (_, index) => {
    const daysAgo = maturityDay + COHORT_COUNT - 1 - index;
    return ptDateKey(new Date(today.getTime() - daysAgo * DAY_MS));
  });
}

function retentionKey(day: number): RetentionKey | null {
  if (day === 1) return "d1";
  if (day === 3) return "d3";
  if (day === 7) return "d7";
  if (day === 14) return "d14";
  return null;
}

export function parseRetentionReport(rows: AnalyticsReportRow[] | undefined): MetricValues["retention"] {
  const result: MetricValues["retention"] = { d1: null, d3: null, d7: null, d14: null };
  const totals: Record<RetentionKey, { active: number; users: number }> = {
    d1: { active: 0, users: 0 },
    d3: { active: 0, users: 0 },
    d7: { active: 0, users: 0 },
    d14: { active: 0, users: 0 }
  };

  for (const row of rows ?? []) {
    const nthDay = Number(row.dimensionValues?.at(-1)?.value);
    const key = retentionKey(nthDay);
    if (!key) continue;

    const activeUsers = Number(row.metricValues?.[0]?.value);
    const totalUsers = Number(row.metricValues?.[1]?.value);
    if (!Number.isFinite(activeUsers) || !Number.isFinite(totalUsers) || totalUsers <= 0) continue;

    totals[key].active += activeUsers;
    totals[key].users += totalUsers;
  }

  for (const key of Object.keys(totals) as RetentionKey[]) {
    if (totals[key].users > 0) {
      result[key] = Math.round((totals[key].active / totals[key].users) * 10_000) / 100;
    }
  }

  return result;
}

function parseRetentionPercentage(rows: AnalyticsReportRow[] | undefined, targetDay: number): number | null {
  const cohortTotals = new Map<string, number>();
  let targetActiveUsers = 0;
  let targetTotalUsers = 0;

  for (const row of rows ?? []) {
    const cohort = row.dimensionValues?.[0]?.value;
    const nthDay = Number(row.dimensionValues?.at(-1)?.value);
    const activeUsers = Number(row.metricValues?.[0]?.value);
    const totalUsers = Number(row.metricValues?.[1]?.value);
    if (!cohort || !Number.isFinite(nthDay) || !Number.isFinite(activeUsers) || !Number.isFinite(totalUsers)) continue;

    if (nthDay === 0 && totalUsers > 0) {
      cohortTotals.set(cohort, totalUsers);
    }
    if (nthDay === targetDay) {
      targetActiveUsers += activeUsers;
      targetTotalUsers += totalUsers;
    }
  }

  const dayZeroTotalUsers = Array.from(cohortTotals.values()).reduce((sum, value) => sum + value, 0);
  const denominator = dayZeroTotalUsers > 0 ? dayZeroTotalUsers : targetTotalUsers;
  if (denominator <= 0) return null;
  return Math.round((targetActiveUsers / denominator) * 10_000) / 100;
}

export function parseRetentionBatchReports(reports: AnalyticsReportResponse[] | undefined): MetricValues["retention"] {
  const result: MetricValues["retention"] = { d1: null, d3: null, d7: null, d14: null };

  RETENTION_DAYS.forEach((day, index) => {
    const key = retentionKey(day);
    if (!key) return;
    result[key] = parseRetentionPercentage(reports?.[index]?.rows, day);
  });

  return result;
}

export function parseRetentionCurveReports(reports: AnalyticsReportResponse[] | undefined): RetentionCurvePoint[] {
  return RETENTION_CURVE_DAYS.map((day) => ({
    day,
    percentage: parseRetentionPercentage(reports?.[day]?.rows, day)
  }));
}

function cohortRequest(retentionDay: number, now: Date) {
  return {
    dimensions: [{ name: "cohort" }, { name: "cohortNthDay" }],
    metrics: [{ name: "cohortActiveUsers" }, { name: "cohortTotalUsers" }],
    cohortSpec: {
      cohorts: retentionCohortDates(retentionDay, now).map((date) => ({
        dimension: "firstSessionDate",
        dateRange: { startDate: date, endDate: date },
        name: `d${retentionDay}_${date.replaceAll("-", "")}`
      })),
      cohortsRange: {
        granularity: "DAILY",
        startOffset: 0,
        endOffset: Math.max(retentionDay, 1)
      }
    }
  };
}

function chunkRequests<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function fetchRetentionReports(
  propertyId: string,
  token: string,
  now: Date
): Promise<AnalyticsReportResponse[]> {
  const requests = RETENTION_CURVE_DAYS.map((day) => cohortRequest(day, now));
  const responses: AnalyticsReportResponse[][] = [];
  for (const batch of chunkRequests(requests, MAX_BATCH_REQUESTS)) {
    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:batchRunReports`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ requests: batch })
      }
    );
    const payload = (await response.json().catch(() => null)) as AnalyticsBatchResponse | null;
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? `Google Analytics returned ${response.status}.`);
    }
    responses.push(payload?.reports ?? []);
  }

  return responses.flat();
}

export async function collectGoogleAnalyticsRetention(
  app: AppConfig,
  now = new Date()
): Promise<Pick<MetricValues, "retention" | "retentionCurve">> {
  if (!app.ga4PropertyId) {
    throw new Error(`${app.displayName} GA4 property ID is missing.`);
  }
  if (!app.firebase) {
    throw new Error(`${app.displayName} service-account credentials are missing.`);
  }

  const auth = new GoogleAuth({
    credentials: {
      client_email: app.firebase.clientEmail,
      private_key: app.firebase.privateKey
    },
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"]
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  const token = typeof accessToken === "string" ? accessToken : accessToken.token;
  if (!token) throw new Error("Could not authorize Google Analytics Data API.");

  const reports = await fetchRetentionReports(app.ga4PropertyId, token, now);
  const retentionCurve = parseRetentionCurveReports(reports);
  return {
    retention: {
      d1: retentionCurve[1]?.percentage ?? null,
      d3: retentionCurve[3]?.percentage ?? null,
      d7: retentionCurve[7]?.percentage ?? null,
      d14: retentionCurve[14]?.percentage ?? null
    },
    retentionCurve
  };
}
