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
  metaSpendUsd?: number | null;
};

export type DailyMetricValueKey = Exclude<keyof DailyMetricPoint, "date">;

export type RetentionCurvePoint = {
  day: number;
  percentage: number | null;
};

export type EpisodeCompletionDistributionPoint = {
  label: string;
  minEpisodes: number;
  maxEpisodes: number | null;
  users: number;
};

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
  episodeCompletionStats: {
    median: number | null;
    p75: number | null;
    max: number | null;
  };
  episodeCompletionDistribution: EpisodeCompletionDistributionPoint[];
  retention: {
    d1: number | null;
    d3: number | null;
    d7: number | null;
    d14: number | null;
  };
  retentionCurve: RetentionCurvePoint[];
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
  accumulatedMetaSpendUsd: {
    total: number | null;
  };
  accumulatedMetaInstalls: {
    total: number | null;
  };
  metaSpendUsd: Record<MetricWindow, number | null>;
  metaInstalls: Record<MetricWindow, number | null>;
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
    analytics?: SourceStatus;
    metaAds?: SourceStatus;
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
  episodeCompletionStats: {
    median: null,
    p75: null,
    max: null
  },
  episodeCompletionDistribution: [],
  retention: {
    d1: null,
    d3: null,
    d7: null,
    d14: null
  },
  retentionCurve: Array.from({ length: 31 }, (_, day) => ({ day, percentage: null })),
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
  accumulatedMetaSpendUsd: {
    total: null
  },
  accumulatedMetaInstalls: {
    total: null
  },
  metaSpendUsd: {
    today: null,
    sevenDays: null,
    thirtyDays: null
  },
  metaInstalls: {
    today: null,
    sevenDays: null,
    thirtyDays: null
  },
  dailyMetrics: []
};

export type FeedbackStatus = "new" | "replied" | "closed";

export type FeedbackItem = {
  id: string;
  uid: string;
  type: "bug" | "idea" | "question";
  message: string;
  contactEmail: string | null;
  isAnonymousUser: boolean;
  isPro: boolean;
  appVersion: string | null;
  osVersion: string | null;
  status: FeedbackStatus;
  createdAt: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
};
