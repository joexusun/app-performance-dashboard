import type { DashboardConfig, AppConfig } from "@/lib/server/config";
import { getPacificDateParts, getPastThirtyDayKeys, getPastThirtyDayRange, type WindowRange } from "@/lib/server/dateWindows";
import type { DailyMetricPoint, MetricValues, MetricWindow } from "@/lib/shared/types";

type GoogleDate = {
  year: number;
  month: number;
  day: number;
};

type AdMobMetricValue = {
  integerValue?: string;
  microsValue?: string;
};

type AdMobReportRow = {
  row?: {
    dimensionValues?: Record<string, { value?: string; displayLabel?: string }>;
    metricValues?: Record<string, AdMobMetricValue>;
  };
};

type AdsWindowMetrics = {
  earningsUsd: number | null;
  ecpmUsd: number | null;
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADMOB_SCOPE = "https://www.googleapis.com/auth/admob.report";

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function microsToCurrency(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed / 1_000_000 : 0;
}

function dateFromIso(value: string): GoogleDate | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function dateFromWindowStart(window: WindowRange): GoogleDate {
  return getPacificDateParts(window.start);
}

function dateFromWindowEnd(window: WindowRange): GoogleDate {
  return getPacificDateParts(window.end);
}

function emptyAdsValues(): Pick<MetricValues, "accumulatedAdsEarningsUsd" | "adsEarningsUsd" | "adsEcpmUsd" | "dailyMetrics"> {
  return {
    accumulatedAdsEarningsUsd: { total: null },
    adsEarningsUsd: {
      today: null,
      sevenDays: null,
      thirtyDays: null
    },
    adsEcpmUsd: {
      today: null,
      sevenDays: null,
      thirtyDays: null
    },
    dailyMetrics: getPastThirtyDayKeys().map((date) => ({
      date,
      users: null,
      subscribers: null,
      activeUsers: null,
      iapSalesUsd: null,
      adsEarningsUsd: 0
    }))
  };
}

function assertAdMobConfig(config: DashboardConfig, app: AppConfig): void {
  if (!config.admob.clientId || !config.admob.clientSecret || !config.admob.refreshToken || !config.admob.publisherAccount) {
    throw new Error("AdMob OAuth credentials or publisher account are missing.");
  }
  if (!app.admobAppId) {
    throw new Error(`${app.displayName} AdMob app ID is missing.`);
  }
  if (!app.adsStartDate || !dateFromIso(app.adsStartDate)) {
    throw new Error(`${app.displayName} ads start date is missing or invalid.`);
  }
}

async function getAccessToken(config: DashboardConfig): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.admob.clientId ?? "",
      client_secret: config.admob.clientSecret ?? "",
      refresh_token: config.admob.refreshToken ?? "",
      grant_type: "refresh_token",
      scope: ADMOB_SCOPE
    })
  });

  const payload = (await response.json().catch(() => null)) as { access_token?: string; error_description?: string } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description ?? "Could not exchange AdMob refresh token.");
  }

  return payload.access_token;
}

async function fetchAdsWindowMetrics(
  config: DashboardConfig,
  app: AppConfig,
  token: string,
  startDate: GoogleDate,
  endDate: GoogleDate
): Promise<AdsWindowMetrics> {
  const response = await fetch(`https://admob.googleapis.com/v1/${config.admob.publisherAccount}/networkReport:generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      reportSpec: {
        dateRange: { startDate, endDate },
        dimensions: ["APP"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM"],
        dimensionFilters: [
          {
            dimension: "APP",
            matchesAny: {
              values: [app.admobAppId]
            }
          }
        ],
        localizationSettings: {
          currencyCode: "USD",
          languageCode: "en-US"
        },
        timeZone: config.timezone
      }
    })
  });

  const payload = (await response.json().catch(() => null)) as AdMobReportRow[] | { error?: { message?: string } } | null;
  if (!response.ok || !Array.isArray(payload)) {
    const message = !Array.isArray(payload) ? payload?.error?.message : null;
    throw new Error(message ?? "Could not fetch AdMob report.");
  }

  let earningsUsd = 0;
  let impressions = 0;
  let reportEcpmUsd: number | null = null;

  for (const item of payload) {
    const metricValues = item.row?.metricValues;
    if (!metricValues) continue;

    earningsUsd += microsToCurrency(metricValues.ESTIMATED_EARNINGS?.microsValue);
    impressions += Number(metricValues.IMPRESSIONS?.integerValue ?? 0);
    if (metricValues.IMPRESSION_RPM?.microsValue) {
      reportEcpmUsd = microsToCurrency(metricValues.IMPRESSION_RPM.microsValue);
    }
  }

  const computedEcpmUsd = impressions > 0 ? (earningsUsd / impressions) * 1000 : null;
  return {
    earningsUsd: roundCurrency(earningsUsd),
    ecpmUsd: reportEcpmUsd !== null ? roundCurrency(reportEcpmUsd) : computedEcpmUsd === null ? null : roundCurrency(computedEcpmUsd)
  };
}

function adMobDateKey(value: string | undefined): string | null {
  if (!value) return null;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dashed = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return dashed?.[1] ?? null;
}

async function fetchDailyAdsEarnings(config: DashboardConfig, app: AppConfig, token: string): Promise<DailyMetricPoint[]> {
  const values = emptyAdsValues().dailyMetrics;
  const byDate = new Map(values.map((point) => [point.date, point]));
  const range = getPastThirtyDayRange();

  const response = await fetch(`https://admob.googleapis.com/v1/${config.admob.publisherAccount}/networkReport:generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      reportSpec: {
        dateRange: {
          startDate: getPacificDateParts(range.start),
          endDate: getPacificDateParts(range.end)
        },
        dimensions: ["DATE", "APP"],
        metrics: ["ESTIMATED_EARNINGS"],
        dimensionFilters: [
          {
            dimension: "APP",
            matchesAny: {
              values: [app.admobAppId]
            }
          }
        ],
        localizationSettings: {
          currencyCode: "USD",
          languageCode: "en-US"
        },
        timeZone: config.timezone
      }
    })
  });

  const payload = (await response.json().catch(() => null)) as AdMobReportRow[] | { error?: { message?: string } } | null;
  if (!response.ok || !Array.isArray(payload)) {
    const message = !Array.isArray(payload) ? payload?.error?.message : null;
    throw new Error(message ?? "Could not fetch daily AdMob report.");
  }

  for (const item of payload) {
    const date = adMobDateKey(item.row?.dimensionValues?.DATE?.value);
    const point = date ? byDate.get(date) : null;
    if (!point) continue;
    point.adsEarningsUsd = roundCurrency((point.adsEarningsUsd ?? 0) + microsToCurrency(item.row?.metricValues?.ESTIMATED_EARNINGS?.microsValue));
  }

  return values;
}

export async function collectAdMobMetrics(
  config: DashboardConfig,
  app: AppConfig,
  windows: WindowRange[]
): Promise<Pick<MetricValues, "accumulatedAdsEarningsUsd" | "adsEarningsUsd" | "adsEcpmUsd" | "dailyMetrics">> {
  assertAdMobConfig(config, app);

  const values = emptyAdsValues();
  const token = await getAccessToken(config);
  const today = getPacificDateParts(new Date());
  const accumulated = await fetchAdsWindowMetrics(config, app, token, dateFromIso(app.adsStartDate ?? "") as GoogleDate, today);
  values.accumulatedAdsEarningsUsd.total = accumulated.earningsUsd;

  const entries = await Promise.all(
    windows.map(async (window) => {
      const metrics = await fetchAdsWindowMetrics(config, app, token, dateFromWindowStart(window), dateFromWindowEnd(window));
      return [window.key, metrics] as const;
    })
  );

  for (const [key, metrics] of entries) {
    values.adsEarningsUsd[key as MetricWindow] = metrics.earningsUsd;
    values.adsEcpmUsd[key as MetricWindow] = metrics.ecpmUsd;
  }
  values.dailyMetrics = await fetchDailyAdsEarnings(config, app, token);

  return values;
}
