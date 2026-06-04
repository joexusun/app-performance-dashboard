import type { Firestore } from "firebase-admin/firestore";
import type { AppKey, AppMetrics, DailyMetricPoint, DailyMetricValueKey, MetricValues } from "@/lib/shared/types";
import { EMPTY_VALUES } from "@/lib/shared/types";

const LEGACY_COLLECTION = "metricSnapshots";
const LATEST_ID = "latest";
const DASHBOARD_DOC_ID = "dashboard";
const SCHEMA_VERSION = 2;
const APP_COLLECTIONS: Record<AppKey, string> = {
  "puzzle-canvas": "puzzleCanvas",
  "savory-advisor": "savoryAdvisor",
  "receipt-cam": "receiptCam"
};
const DAILY_FIELDS: DailyMetricValueKey[] = [
  "users",
  "downloads",
  "subscribers",
  "activeUsers",
  "onboardedUsers",
  "iapSalesUsd",
  "subscriptionSalesUsd",
  "goldPackSalesUsd",
  "newCanvasSalesUsd",
  "assistRefillMemberSalesUsd",
  "assistRefillNonMemberSalesUsd",
  "adsEarningsUsd",
  "adsEcpmUsd"
];

function cloneEmptyValues(): MetricValues {
  return structuredClone(EMPTY_VALUES);
}

function dailyPointBase(date: string): DailyMetricPoint {
  return {
    date,
    users: null,
    downloads: null,
    subscribers: null,
    activeUsers: null,
    onboardedUsers: null,
    iapSalesUsd: null,
    subscriptionSalesUsd: null,
    goldPackSalesUsd: null,
    newCanvasSalesUsd: null,
    assistRefillMemberSalesUsd: null,
    assistRefillNonMemberSalesUsd: null,
    adsEarningsUsd: null,
    adsEcpmUsd: null
  };
}

function mergeDailyMetrics(...series: Array<DailyMetricPoint[] | undefined>): DailyMetricPoint[] {
  const merged = new Map<string, DailyMetricPoint>();

  for (const points of series) {
    for (const point of points ?? []) {
      const existing = merged.get(point.date) ?? dailyPointBase(point.date);
      const next = { ...existing };
      for (const field of DAILY_FIELDS) {
        const value = point[field];
        if (value !== null && value !== undefined) {
          next[field] = value;
        }
      }
      merged.set(point.date, next);
    }
  }

  return Array.from(merged.values()).sort((left, right) => left.date.localeCompare(right.date));
}

export function mergeValues(values: Partial<MetricValues>): MetricValues {
  const merged = cloneEmptyValues();
  return {
    users: { ...merged.users, ...values.users },
    downloads: { ...merged.downloads, ...values.downloads },
    activeUsers: { ...merged.activeUsers, ...values.activeUsers },
    subscriptions: { ...merged.subscriptions, ...values.subscriptions },
    accumulatedSalesUsd: { ...merged.accumulatedSalesUsd, ...values.accumulatedSalesUsd },
    accumulatedAdsEarningsUsd: { ...merged.accumulatedAdsEarningsUsd, ...values.accumulatedAdsEarningsUsd },
    subscriptionSalesUsd: { ...merged.subscriptionSalesUsd, ...values.subscriptionSalesUsd },
    monthlySubscriptionSalesUsd: { ...merged.monthlySubscriptionSalesUsd, ...values.monthlySubscriptionSalesUsd },
    annualSubscriptionSalesUsd: { ...merged.annualSubscriptionSalesUsd, ...values.annualSubscriptionSalesUsd },
    adsEarningsUsd: { ...merged.adsEarningsUsd, ...values.adsEarningsUsd },
    adsEcpmUsd: { ...merged.adsEcpmUsd, ...values.adsEcpmUsd },
    consumableRevenueUsd: { ...merged.consumableRevenueUsd, ...values.consumableRevenueUsd },
    dailyMetrics: mergeDailyMetrics(values.dailyMetrics)
  };
}

function appCollection(appKey: AppKey): string {
  return APP_COLLECTIONS[appKey];
}

function appSpecificDailyFields(appKey: AppKey): DailyMetricValueKey[] {
  if (appKey === "puzzle-canvas") {
    return [
      "users",
      "subscribers",
      "activeUsers",
      "onboardedUsers",
      "iapSalesUsd",
      "subscriptionSalesUsd",
      "goldPackSalesUsd",
      "newCanvasSalesUsd",
      "adsEarningsUsd",
      "adsEcpmUsd"
    ];
  }

  if (appKey === "savory-advisor") {
    return [
      "users",
      "downloads",
      "subscribers",
      "activeUsers",
      "iapSalesUsd",
      "assistRefillMemberSalesUsd",
      "assistRefillNonMemberSalesUsd"
    ];
  }

  return ["users", "downloads", "subscribers", "activeUsers", "iapSalesUsd"];
}

function dailyDocFromPoint(metric: AppMetrics, point: DailyMetricPoint, generatedAt: string, runId: string): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    appKey: metric.appKey,
    date: point.date,
    timezone: metric.timezone,
    sourceStatuses: metric.sourceStatuses,
    sourceRunId: runId,
    lastUpdatedAt: generatedAt
  };

  for (const field of appSpecificDailyFields(metric.appKey)) {
    const value = point[field];
    if (value !== undefined) {
      doc[field] = value;
    }
  }

  if (metric.appKey === "puzzle-canvas" && point.date === metric.values.dailyMetrics.at(-1)?.date) {
    doc.accumulatedSalesUsd = metric.values.accumulatedSalesUsd.total;
    doc.accumulatedAdsEarningsUsd = metric.values.accumulatedAdsEarningsUsd.total;
  }

  return doc;
}

function mergeHistoricalDoc(existing: Record<string, unknown>, incoming: Record<string, unknown>, generatedAt: string): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...existing,
    schemaVersion: incoming.schemaVersion,
    appKey: incoming.appKey,
    date: incoming.date,
    timezone: incoming.timezone,
    sourceStatuses: incoming.sourceStatuses,
    sourceRunId: incoming.sourceRunId,
    firstSeenAt: typeof existing.firstSeenAt === "string" ? existing.firstSeenAt : generatedAt,
    lastUpdatedAt: generatedAt
  };

  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined) {
      merged[key] = value;
    } else if (!(key in merged)) {
      merged[key] = value;
    }
  }

  return merged;
}

function refreshRunStatus(sourceStatuses: AppMetrics["sourceStatuses"]): "success" | "partial" | "failed" {
  const statuses = Object.values(sourceStatuses);
  const failed = statuses.filter((source) => !source.ok && !/not configured|not used/i.test(source.message));
  if (failed.length === 0) return "success";
  if (failed.length === statuses.length) return "failed";
  return "partial";
}

async function readAppCollectionSnapshot(db: Firestore, appKey: AppKey): Promise<AppMetrics | null> {
  const dashboardRef = db.collection(appCollection(appKey)).doc(DASHBOARD_DOC_ID);
  const dashboard = await dashboardRef.get();
  if (!dashboard.exists) return null;

  const data = dashboard.data();
  const metric = data?.summary as AppMetrics | undefined;
  if (!metric) return null;

  const dailySnapshot = await dashboardRef.collection("dailyMetrics").orderBy("date", "asc").limitToLast(30).get();
  metric.values.dailyMetrics = mergeDailyMetrics(
    metric.values.dailyMetrics,
    dailySnapshot.docs.map((doc) => doc.data() as DailyMetricPoint)
  );
  return metric;
}

async function readLegacySnapshots(db: Firestore): Promise<AppMetrics[]> {
  const snapshot = await db.collection(LEGACY_COLLECTION).doc(LATEST_ID).collection("apps").get();
  return snapshot.docs.map((doc) => doc.data() as AppMetrics);
}

export async function readLatestSnapshots(db: Firestore): Promise<AppMetrics[]> {
  const snapshots = (
    await Promise.all((Object.keys(APP_COLLECTIONS) as AppKey[]).map((appKey) => readAppCollectionSnapshot(db, appKey)))
  ).filter((snapshot): snapshot is AppMetrics => Boolean(snapshot));

  if (snapshots.length > 0) {
    return snapshots;
  }

  return readLegacySnapshots(db);
}

export async function writeLatestSnapshot(db: Firestore, metrics: AppMetrics[]): Promise<void> {
  const batch = db.batch();
  const generatedAt = new Date().toISOString();
  const runId = generatedAt.replace(/[:.]/g, "-");
  const rootRef = db.collection(LEGACY_COLLECTION).doc(LATEST_ID);
  batch.set(
    rootRef,
    {
      generatedAt,
      appCount: metrics.length
    },
    { merge: true }
  );

  for (const metric of metrics) {
    const dashboardRef = db.collection(appCollection(metric.appKey)).doc(DASHBOARD_DOC_ID);
    batch.set(
      dashboardRef,
      {
        schemaVersion: SCHEMA_VERSION,
        appKey: metric.appKey,
        displayName: metric.displayName,
        timezone: metric.timezone,
        latestGeneratedAt: metric.generatedAt,
        sourceStatuses: metric.sourceStatuses,
        summary: metric
      },
      { merge: false }
    );

    for (const point of metric.values.dailyMetrics) {
      const dailyRef = dashboardRef.collection("dailyMetrics").doc(point.date);
      const existing = await dailyRef.get();
      const incoming = dailyDocFromPoint(metric, point, generatedAt, runId);
      batch.set(dailyRef, mergeHistoricalDoc(existing.data() ?? {}, incoming, generatedAt), { merge: false });
    }

    batch.set(
      dashboardRef.collection("refreshRuns").doc(runId),
      {
        schemaVersion: SCHEMA_VERSION,
        generatedAt,
        timezone: metric.timezone,
        status: refreshRunStatus(metric.sourceStatuses),
        sourceStatuses: metric.sourceStatuses,
        daysWritten: metric.values.dailyMetrics.length
      },
      { merge: false }
    );

    batch.set(rootRef.collection("apps").doc(metric.appKey), metric, { merge: false });
  }

  await batch.commit();
}

export function sumMetricValues(apps: AppMetrics[]): MetricValues {
  const totals = cloneEmptyValues();
  for (const app of apps) {
    totals.users.total = (totals.users.total ?? 0) + (app.values.users?.total ?? 0);
    totals.downloads.firstTime = (totals.downloads.firstTime ?? 0) + (app.values.downloads.firstTime ?? 0);
    totals.activeUsers.today = (totals.activeUsers.today ?? 0) + (app.values.activeUsers.today ?? 0);
    totals.activeUsers.sevenDays = (totals.activeUsers.sevenDays ?? 0) + (app.values.activeUsers.sevenDays ?? 0);
    totals.activeUsers.thirtyDays = (totals.activeUsers.thirtyDays ?? 0) + (app.values.activeUsers.thirtyDays ?? 0);
    totals.subscriptions.monthly = (totals.subscriptions.monthly ?? 0) + (app.values.subscriptions.monthly ?? 0);
    totals.subscriptions.annual = (totals.subscriptions.annual ?? 0) + (app.values.subscriptions.annual ?? 0);
    totals.accumulatedSalesUsd.total =
      Math.round(((totals.accumulatedSalesUsd.total ?? 0) + (app.values.accumulatedSalesUsd?.total ?? 0)) * 100) / 100;
    totals.accumulatedAdsEarningsUsd.total =
      Math.round(((totals.accumulatedAdsEarningsUsd.total ?? 0) + (app.values.accumulatedAdsEarningsUsd?.total ?? 0)) * 100) /
      100;
    totals.subscriptionSalesUsd.today =
      Math.round(((totals.subscriptionSalesUsd.today ?? 0) + (app.values.subscriptionSalesUsd?.today ?? 0)) * 100) / 100;
    totals.subscriptionSalesUsd.sevenDays =
      Math.round(((totals.subscriptionSalesUsd.sevenDays ?? 0) + (app.values.subscriptionSalesUsd?.sevenDays ?? 0)) * 100) /
      100;
    totals.subscriptionSalesUsd.thirtyDays =
      Math.round(((totals.subscriptionSalesUsd.thirtyDays ?? 0) + (app.values.subscriptionSalesUsd?.thirtyDays ?? 0)) * 100) /
      100;
    for (const window of ["today", "sevenDays", "thirtyDays"] as const) {
      totals.monthlySubscriptionSalesUsd[window] =
        Math.round(
          ((totals.monthlySubscriptionSalesUsd[window] ?? 0) + (app.values.monthlySubscriptionSalesUsd?.[window] ?? 0)) * 100
        ) / 100;
      totals.annualSubscriptionSalesUsd[window] =
        Math.round(
          ((totals.annualSubscriptionSalesUsd[window] ?? 0) + (app.values.annualSubscriptionSalesUsd?.[window] ?? 0)) * 100
        ) / 100;
    }
    totals.adsEarningsUsd.today =
      Math.round(((totals.adsEarningsUsd.today ?? 0) + (app.values.adsEarningsUsd?.today ?? 0)) * 100) / 100;
    totals.adsEarningsUsd.sevenDays =
      Math.round(((totals.adsEarningsUsd.sevenDays ?? 0) + (app.values.adsEarningsUsd?.sevenDays ?? 0)) * 100) / 100;
    totals.adsEarningsUsd.thirtyDays =
      Math.round(((totals.adsEarningsUsd.thirtyDays ?? 0) + (app.values.adsEarningsUsd?.thirtyDays ?? 0)) * 100) / 100;
    totals.adsEcpmUsd.today = Math.round(((totals.adsEcpmUsd.today ?? 0) + (app.values.adsEcpmUsd?.today ?? 0)) * 100) / 100;
    totals.adsEcpmUsd.sevenDays =
      Math.round(((totals.adsEcpmUsd.sevenDays ?? 0) + (app.values.adsEcpmUsd?.sevenDays ?? 0)) * 100) / 100;
    totals.adsEcpmUsd.thirtyDays =
      Math.round(((totals.adsEcpmUsd.thirtyDays ?? 0) + (app.values.adsEcpmUsd?.thirtyDays ?? 0)) * 100) / 100;
    totals.consumableRevenueUsd.today =
      Math.round(((totals.consumableRevenueUsd.today ?? 0) + (app.values.consumableRevenueUsd.today ?? 0)) * 100) / 100;
    totals.consumableRevenueUsd.sevenDays =
      Math.round(((totals.consumableRevenueUsd.sevenDays ?? 0) + (app.values.consumableRevenueUsd.sevenDays ?? 0)) * 100) / 100;
    totals.consumableRevenueUsd.thirtyDays =
      Math.round(((totals.consumableRevenueUsd.thirtyDays ?? 0) + (app.values.consumableRevenueUsd.thirtyDays ?? 0)) * 100) /
      100;
    totals.dailyMetrics = mergeDailyMetrics(totals.dailyMetrics, app.values.dailyMetrics);
  }
  return totals;
}
