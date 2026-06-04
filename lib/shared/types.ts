export type AppKey = "puzzle-canvas" | "savory-advisor" | "receipt-cam";

export type MetricWindow = "today" | "sevenDays" | "thirtyDays";

export type SourceStatus = {
  ok: boolean;
  message: string;
  updatedAt?: string;
};

export type DailyMetricPoint = {
  date: string;
  users?: number | null;
  downloads?: number | null;
  subscribers?: number | null;
  activeUsers?: number | null;
  onboardedUsers?: number | null;
  iapSalesUsd?: number | null;
  subscriptionSalesUsd?: number | null;
  goldPackSalesUsd?: number | null;
  newCanvasSalesUsd?: number | null;
  assistRefillMemberSalesUsd?: number | null;
  assistRefillNonMemberSalesUsd?: number | null;
  adsEarningsUsd?: number | null;
  adsEcpmUsd?: number | null;
};

export type DailyMetricValueKey = Exclude<keyof DailyMetricPoint, "date">;

export type MetricValues = {
  users: {
    total: number | null;
  };
  downloads: {
    firstTime: number | null;
  };
  activeUsers: Record<MetricWindow, number | null>;
  subscriptions: {
    monthly: number | null;
    annual: number | null;
  };
  accumulatedSalesUsd: {
    total: number | null;
  };
  accumulatedAdsEarningsUsd: {
    total: number | null;
  };
  subscriptionSalesUsd: Record<MetricWindow, number | null>;
  monthlySubscriptionSalesUsd: Record<MetricWindow, number | null>;
  annualSubscriptionSalesUsd: Record<MetricWindow, number | null>;
  adsEarningsUsd: Record<MetricWindow, number | null>;
  adsEcpmUsd: Record<MetricWindow, number | null>;
  consumableRevenueUsd: Record<MetricWindow, number | null>;
  dailyMetrics: DailyMetricPoint[];
};

export type ProductSalesMetric = {
  key: string;
  label: string;
  values: Record<MetricWindow, number | null>;
};

export type AppMetrics = {
  appKey: AppKey;
  displayName: string;
  values: MetricValues;
  productSales: ProductSalesMetric[];
  sourceStatuses: {
    firestore: SourceStatus;
    appStore: SourceStatus;
    ads: SourceStatus;
    snapshot: SourceStatus;
  };
  generatedAt: string | null;
  timezone: string;
};

export type MetricsResponse = {
  apps: AppMetrics[];
  totals: MetricValues;
  lastUpdatedAt: string | null;
  stale: boolean;
  refreshStatus?: SourceStatus;
};

export type RefreshResponse = MetricsResponse & {
  refreshed: boolean;
};

export const EMPTY_VALUES: MetricValues = {
  users: {
    total: null
  },
  downloads: {
    firstTime: null
  },
  activeUsers: {
    today: null,
    sevenDays: null,
    thirtyDays: null
  },
  subscriptions: {
    monthly: null,
    annual: null
  },
  accumulatedSalesUsd: {
    total: null
  },
  accumulatedAdsEarningsUsd: {
    total: null
  },
  subscriptionSalesUsd: {
    today: null,
    sevenDays: null,
    thirtyDays: null
  },
  monthlySubscriptionSalesUsd: {
    today: null,
    sevenDays: null,
    thirtyDays: null
  },
  annualSubscriptionSalesUsd: {
    today: null,
    sevenDays: null,
    thirtyDays: null
  },
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
  consumableRevenueUsd: {
    today: null,
    sevenDays: null,
    thirtyDays: null
  },
  dailyMetrics: []
};
