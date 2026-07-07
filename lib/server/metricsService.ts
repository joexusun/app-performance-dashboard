import type { AppMetrics, MetricsResponse, ProductSalesMetric, RefreshResponse, SourceStatus } from "@/lib/shared/types";
import { EMPTY_VALUES } from "@/lib/shared/types";
import { getDashboardConfig, type AppConfig } from "@/lib/server/config";
import { getMetricWindows } from "@/lib/server/dateWindows";
import { getDb } from "@/lib/server/firebaseAdmin";
import { collectFirestoreMetrics } from "@/lib/server/firestoreMetrics";
import { fetchFirstTimeDownloads } from "@/lib/server/appStore";
import { collectAdMobMetrics } from "@/lib/server/adMob";
import { collectGoogleAnalyticsRetention } from "@/lib/server/googleAnalytics";
import { mergeValues, readLatestSnapshots, sumMetricValues, writeLatestSnapshot } from "@/lib/server/snapshots";

function cloneEmptyValues() {
  return structuredClone(EMPTY_VALUES);
}

function emptyProductSales(app: AppConfig): ProductSalesMetric[] {
  return app.productSales.map((product) => ({
    key: product.key,
    label: product.label,
    values: {
      today: null,
      sevenDays: null,
      thirtyDays: null
    }
  }));
}

function status(ok: boolean, message: string): SourceStatus {
  return { ok, message, updatedAt: new Date().toISOString() };
}

function emptyAppMetrics(app: AppConfig, message: string): AppMetrics {
  return {
    appKey: app.key,
    displayName: app.displayName,
    values: cloneEmptyValues(),
    productSales: emptyProductSales(app),
    sourceStatuses: {
      firestore: status(false, message),
      appStore: status(false, message),
      ads: status(false, message),
      analytics: status(false, message),
      snapshot: status(false, "No snapshot available.")
    },
    generatedAt: null,
    timezone: "America/Los_Angeles"
  };
}

function latestUpdatedAt(apps: AppMetrics[]): string | null {
  const times = apps.map((app) => app.generatedAt).filter((value): value is string => Boolean(value));
  if (times.length === 0) return null;
  return times.sort().at(-1) ?? null;
}

function isStale(lastUpdatedAt: string | null, refreshIntervalMs: number): boolean {
  if (!lastUpdatedAt) return true;
  return Date.now() - new Date(lastUpdatedAt).getTime() >= refreshIntervalMs;
}

async function collectAppMetrics(app: AppConfig): Promise<AppMetrics> {
  const config = getDashboardConfig();
  const windows = getMetricWindows();
  const values = cloneEmptyValues();
  let productSales = emptyProductSales(app);
  let firestoreStatus = status(false, "Source Firebase credentials are missing.");
  let appStoreStatus =
    app.downloadsSource === "firestore-users"
      ? status(true, "App Store downloads are not used for this app.")
      : status(false, "App Store Connect credentials are missing.");
  let adsStatus = status(false, "AdMob is not configured for this app.");
  let analyticsStatus = status(false, "Google Analytics is not configured for this app.");

  if (app.firebase) {
    try {
      const db = getDb(`source-${app.key}`, app.firebase);
      const firestoreValues = await collectFirestoreMetrics(db, app, windows);
      Object.assign(values, mergeValues({ ...values, ...firestoreValues }));
      productSales = firestoreValues.productSales;
      firestoreStatus = status(true, "Firestore metrics collected.");
    } catch (error) {
      firestoreStatus = status(false, error instanceof Error ? error.message : "Firestore collection failed.");
    }
  }

  if (app.downloadsSource === "app-store") {
    try {
      values.downloads.firstTime = await fetchFirstTimeDownloads(config, app);
      appStoreStatus = status(true, "App Store downloads collected.");
    } catch (error) {
      appStoreStatus = status(false, error instanceof Error ? error.message : "App Store collection failed.");
    }
  }

  if (app.admobAppId) {
    try {
      const adMobValues = await collectAdMobMetrics(config, app, windows);
      Object.assign(values, mergeValues({ ...values, ...adMobValues, dailyMetrics: [...values.dailyMetrics, ...adMobValues.dailyMetrics] }));
      adsStatus = status(true, "AdMob metrics collected.");
    } catch (error) {
      adsStatus = status(false, error instanceof Error ? error.message : "AdMob collection failed.");
    }
  }

  if (app.key === "puzzle-canvas" && app.ga4PropertyId) {
    try {
      const analyticsValues = await collectGoogleAnalyticsRetention(app);
      values.retention = analyticsValues.retention;
      values.retentionCurve = analyticsValues.retentionCurve;
      analyticsStatus = status(true, "Google Analytics retention collected.");
    } catch (error) {
      analyticsStatus = status(false, error instanceof Error ? error.message : "Google Analytics collection failed.");
    }
  }

  return {
    appKey: app.key,
    displayName: app.displayName,
    values,
    productSales,
    sourceStatuses: {
      firestore: firestoreStatus,
      appStore: appStoreStatus,
      ads: adsStatus,
      analytics: analyticsStatus,
      snapshot: status(true, "Snapshot generated.")
    },
    generatedAt: new Date().toISOString(),
    timezone: config.timezone
  };
}

function buildResponse(apps: AppMetrics[], refreshStatus?: SourceStatus): MetricsResponse {
  const config = getDashboardConfig();
  const lastUpdatedAt = latestUpdatedAt(apps);
  return {
    apps,
    totals: sumMetricValues(apps),
    lastUpdatedAt,
    stale: isStale(lastUpdatedAt, config.refreshIntervalMs),
    refreshStatus
  };
}

function orderedAppMetrics(snapshots: AppMetrics[], configApps: AppConfig[]): AppMetrics[] {
  return configApps.map(
    (app) => snapshots.find((snapshot) => snapshot.appKey === app.key) ?? emptyAppMetrics(app, "No snapshot for this app.")
  );
}

export async function readMetrics(): Promise<MetricsResponse> {
  const config = getDashboardConfig();
  if (!config.dashboardFirebase) {
    const apps = config.apps.map((app) => emptyAppMetrics(app, "Dashboard Firebase credentials are missing."));
    return buildResponse(apps, status(false, "Dashboard Firebase credentials are missing."));
  }

  try {
    const db = getDb("dashboard", config.dashboardFirebase);
    const snapshots = await readLatestSnapshots(db);
    if (snapshots.length === 0) {
      return buildResponse(config.apps.map((app) => emptyAppMetrics(app, "No snapshot has been generated yet.")));
    }

    const ordered = orderedAppMetrics(snapshots, config.apps);

    if (isStale(latestUpdatedAt(ordered), config.refreshIntervalMs)) {
      return await refreshMetrics(ordered);
    }

    return buildResponse(ordered);
  } catch (error) {
    const apps = config.apps.map((app) => emptyAppMetrics(app, "Could not read dashboard snapshots."));
    return buildResponse(apps, status(false, error instanceof Error ? error.message : "Snapshot read failed."));
  }
}

export async function refreshMetrics(previousApps?: AppMetrics[]): Promise<RefreshResponse> {
  const config = getDashboardConfig();
  if (!config.dashboardFirebase) {
    const apps = previousApps ?? config.apps.map((app) => emptyAppMetrics(app, "Dashboard Firebase credentials are missing."));
    return { ...buildResponse(apps, status(false, "Dashboard Firebase credentials are missing.")), refreshed: false };
  }

  const db = getDb("dashboard", config.dashboardFirebase);
  let snapshotApps = previousApps;
  if (!snapshotApps) {
    try {
      snapshotApps = orderedAppMetrics(await readLatestSnapshots(db), config.apps);
    } catch {
      snapshotApps = undefined;
    }
  }

  const collected = await Promise.all(config.apps.map((app) => collectAppMetrics(app)));
  const stableMetrics = collected.map((metric) => {
    const previous = snapshotApps?.find((app) => app.appKey === metric.appKey);
    if (!previous) return metric;

    const values = mergeValues(metric.values);
    const mergedDailyMetrics = mergeValues({ dailyMetrics: [...previous.values.dailyMetrics, ...metric.values.dailyMetrics] }).dailyMetrics;
    values.dailyMetrics = mergedDailyMetrics;
    if (!metric.sourceStatuses.firestore.ok) {
      values.users = previous.values.users;
      values.activeUsers = previous.values.activeUsers;
      values.subscriptions = previous.values.subscriptions;
      values.episodeCompletionStats = previous.values.episodeCompletionStats;
      values.episodeCompletionDistribution = previous.values.episodeCompletionDistribution;
      values.accumulatedSalesUsd = previous.values.accumulatedSalesUsd;
      values.subscriptionSalesUsd = previous.values.subscriptionSalesUsd;
      values.monthlySubscriptionSalesUsd = previous.values.monthlySubscriptionSalesUsd;
      values.annualSubscriptionSalesUsd = previous.values.annualSubscriptionSalesUsd;
      values.consumableRevenueUsd = previous.values.consumableRevenueUsd;
      values.dailyMetrics = mergedDailyMetrics;
    }
    if (!metric.sourceStatuses.ads?.ok) {
      values.accumulatedAdsEarningsUsd = previous.values.accumulatedAdsEarningsUsd;
      values.adsEarningsUsd = previous.values.adsEarningsUsd;
      values.adsEcpmUsd = previous.values.adsEcpmUsd;
      values.dailyMetrics = mergedDailyMetrics;
    }
    const previousRetention = previous.values.retention;
    const previousRetentionCurve = previous.values.retentionCurve;
    const hasPreviousRetention =
      (previousRetention && Object.values(previousRetention).some((value) => value !== null && value !== undefined)) ||
      previousRetentionCurve?.some((point) => point.percentage !== null && point.percentage !== undefined);
    const analyticsUnavailable =
      metric.appKey === "puzzle-canvas" && !metric.sourceStatuses.analytics?.ok && Boolean(hasPreviousRetention);
    if (analyticsUnavailable) {
      values.retention = previous.values.retention ?? cloneEmptyValues().retention;
      values.retentionCurve = previous.values.retentionCurve ?? cloneEmptyValues().retentionCurve;
    }
    if (!metric.sourceStatuses.appStore.ok) {
      values.downloads = previous.values.downloads;
    }

    const preserved =
      !metric.sourceStatuses.firestore.ok ||
      !metric.sourceStatuses.appStore.ok ||
      !metric.sourceStatuses.ads?.ok ||
      analyticsUnavailable;
    return {
      ...metric,
      values,
      productSales: metric.sourceStatuses.firestore.ok ? metric.productSales : previous.productSales,
      sourceStatuses: {
        ...metric.sourceStatuses,
        snapshot: preserved
          ? status(false, "One or more sources failed; preserved previous successful values for that source.")
          : metric.sourceStatuses.snapshot
      }
    };
  });

  try {
    await writeLatestSnapshot(db, stableMetrics);
    const persisted = orderedAppMetrics(await readLatestSnapshots(db), config.apps);
    return { ...buildResponse(persisted, status(true, "Metrics refreshed.")), refreshed: true };
  } catch (error) {
    return {
      ...buildResponse(
        snapshotApps ?? stableMetrics,
        status(false, error instanceof Error ? error.message : "Snapshot write failed.")
      ),
      refreshed: false
    };
  }
}
