import { createHmac } from "node:crypto";
import type { AppConfig, DashboardConfig } from "@/lib/server/config";
import { getPastThirtyDayKeys } from "@/lib/server/dateWindows";
import type { MetricValues, MetricWindow } from "@/lib/shared/types";

const GRAPH_BASE = "https://graph.facebook.com/v23.0";
const MAX_PAGES = 10;

type InsightsAction = {
  action_type?: string;
  value?: string;
};

type InsightsRow = {
  date_start?: string;
  spend?: string;
  actions?: InsightsAction[];
};

type InsightsResponse = {
  data?: InsightsRow[];
  paging?: { next?: string };
  error?: { message?: string };
};

type MetaAdsValues = Pick<
  MetricValues,
  "accumulatedMetaSpendUsd" | "accumulatedMetaInstalls" | "metaSpendUsd" | "metaInstalls" | "dailyMetrics"
>;

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function installsFromActions(actions: InsightsAction[] | undefined): number {
  let installs = 0;
  for (const action of actions ?? []) {
    if (action.action_type === "mobile_app_install") {
      installs += Number(action.value ?? 0);
    }
  }
  return installs;
}

function assertMetaAdsConfig(config: DashboardConfig, app: AppConfig): void {
  if (!config.metaAds.accessToken) {
    throw new Error("Meta access token is missing.");
  }
  if (!app.metaAdAccountId) {
    throw new Error(`${app.displayName} Meta ad account ID is missing.`);
  }
}

function authParams(config: DashboardConfig): Record<string, string> {
  const token = config.metaAds.accessToken ?? "";
  const params: Record<string, string> = { access_token: token };
  if (config.metaAds.appSecret) {
    params.appsecret_proof = createHmac("sha256", config.metaAds.appSecret).update(token).digest("hex");
  }
  return params;
}

async function fetchInsights(config: DashboardConfig, app: AppConfig, params: Record<string, string>): Promise<InsightsRow[]> {
  const query = new URLSearchParams({ ...params, ...authParams(config) });
  let url: string | null = `${GRAPH_BASE}/${app.metaAdAccountId}/insights?${query.toString()}`;
  const rows: InsightsRow[] = [];

  for (let page = 0; url && page < MAX_PAGES; page += 1) {
    const response = await fetch(url);
    const payload = (await response.json().catch(() => null)) as InsightsResponse | null;
    if (!response.ok || !payload || payload.error || !Array.isArray(payload.data)) {
      throw new Error(payload?.error?.message ?? `Could not fetch Meta insights for ${app.displayName}.`);
    }
    rows.push(...payload.data);
    url = payload.paging?.next ?? null;
  }

  return rows;
}

export async function collectMetaAdsMetrics(config: DashboardConfig, app: AppConfig): Promise<MetaAdsValues> {
  assertMetaAdsConfig(config, app);

  const values: MetaAdsValues = {
    accumulatedMetaSpendUsd: { total: null },
    accumulatedMetaInstalls: { total: null },
    metaSpendUsd: { today: null, sevenDays: null, thirtyDays: null },
    metaInstalls: { today: null, sevenDays: null, thirtyDays: null },
    dailyMetrics: []
  };

  // Lifetime totals: one aggregate row across the account's full history.
  const lifetimeRows = await fetchInsights(config, app, {
    fields: "spend,actions",
    date_preset: "maximum"
  });
  let lifetimeSpend = 0;
  let lifetimeInstalls = 0;
  for (const row of lifetimeRows) {
    lifetimeSpend += Number(row.spend ?? 0);
    lifetimeInstalls += installsFromActions(row.actions);
  }
  values.accumulatedMetaSpendUsd.total = roundCurrency(lifetimeSpend);
  values.accumulatedMetaInstalls.total = lifetimeInstalls;

  // Daily rows for the past 30 days (account timezone; matches the dashboard's
  // Pacific day keys for US accounts). Days without delivery are omitted by Meta.
  const dayKeys = getPastThirtyDayKeys();
  const dailyRows = await fetchInsights(config, app, {
    fields: "spend,actions",
    time_increment: "1",
    limit: "100",
    time_range: JSON.stringify({ since: dayKeys[0], until: dayKeys[dayKeys.length - 1] })
  });

  const spendByDate = new Map<string, number>();
  const installsByDate = new Map<string, number>();
  for (const row of dailyRows) {
    const date = row.date_start;
    if (!date) continue;
    spendByDate.set(date, (spendByDate.get(date) ?? 0) + Number(row.spend ?? 0));
    installsByDate.set(date, (installsByDate.get(date) ?? 0) + installsFromActions(row.actions));
  }

  values.dailyMetrics = dayKeys.map((date) => ({
    date,
    metaSpendUsd: spendByDate.has(date) ? roundCurrency(spendByDate.get(date) ?? 0) : 0
  }));

  const windowSizes: Array<[MetricWindow, number]> = [
    ["today", 1],
    ["sevenDays", 7],
    ["thirtyDays", 30]
  ];
  for (const [window, size] of windowSizes) {
    const keys = dayKeys.slice(-size);
    values.metaSpendUsd[window] = roundCurrency(keys.reduce((sum, key) => sum + (spendByDate.get(key) ?? 0), 0));
    values.metaInstalls[window] = keys.reduce((sum, key) => sum + (installsByDate.get(key) ?? 0), 0);
  }

  return values;
}
