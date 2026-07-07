import { describe, expect, it } from "vitest";
import type { AppMetrics } from "@/lib/shared/types";
import {
  episodeCompletionValue,
  episodeCompletionDistribution,
  isProductionEnvironment,
  isSandboxEnvironment,
  summarizeEpisodeCompletions
} from "@/lib/server/firestoreMetrics";
import { readLatestSnapshots, sumMetricValues, writeLatestSnapshot } from "@/lib/server/snapshots";

type StoredDoc = Record<string, unknown>;

class FakeDocumentSnapshot {
  constructor(
    public id: string,
    private value: StoredDoc | undefined
  ) {}

  get exists() {
    return Boolean(this.value);
  }

  data() {
    return this.value;
  }
}

class FakeQuerySnapshot {
  constructor(public docs: FakeDocumentSnapshot[]) {}
}

class FakeBatch {
  private writes: Array<{ path: string; value: StoredDoc; merge: boolean }> = [];

  constructor(private store: Map<string, StoredDoc>) {}

  set(ref: FakeDocumentReference, value: StoredDoc, options?: { merge?: boolean }) {
    this.writes.push({ path: ref.path, value, merge: Boolean(options?.merge) });
  }

  async commit() {
    for (const write of this.writes) {
      const existing = this.store.get(write.path) ?? {};
      this.store.set(write.path, write.merge ? { ...existing, ...write.value } : write.value);
    }
  }
}

class FakeQuery {
  private lastLimit: number | null = null;

  constructor(
    private store: Map<string, StoredDoc>,
    private path: string,
    private orderField: string
  ) {}

  limitToLast(limit: number) {
    this.lastLimit = limit;
    return this;
  }

  async get() {
    const docs = directChildren(this.store, this.path).sort((left, right) =>
      String(left.data()?.[this.orderField] ?? "").localeCompare(String(right.data()?.[this.orderField] ?? ""))
    );
    return new FakeQuerySnapshot(this.lastLimit === null ? docs : docs.slice(-this.lastLimit));
  }
}

class FakeCollectionReference {
  constructor(
    private store: Map<string, StoredDoc>,
    private path: string
  ) {}

  doc(id: string) {
    return new FakeDocumentReference(this.store, `${this.path}/${id}`);
  }

  orderBy(field: string) {
    return new FakeQuery(this.store, this.path, field);
  }

  async get() {
    return new FakeQuerySnapshot(directChildren(this.store, this.path));
  }
}

class FakeDocumentReference {
  constructor(
    private store: Map<string, StoredDoc>,
    public path: string
  ) {}

  collection(name: string) {
    return new FakeCollectionReference(this.store, `${this.path}/${name}`);
  }

  async get() {
    return new FakeDocumentSnapshot(this.path.split("/").at(-1) ?? "", this.store.get(this.path));
  }
}

class FakeFirestore {
  store = new Map<string, StoredDoc>();

  collection(name: string) {
    return new FakeCollectionReference(this.store, name);
  }

  batch() {
    return new FakeBatch(this.store);
  }
}

function directChildren(store: Map<string, StoredDoc>, collectionPath: string): FakeDocumentSnapshot[] {
  const prefix = `${collectionPath}/`;
  return Array.from(store.entries())
    .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
    .map(([path, value]) => new FakeDocumentSnapshot(path.split("/").at(-1) ?? "", value));
}

function appMetric(values: Partial<AppMetrics["values"]>, appKey: AppMetrics["appKey"] = "puzzle-canvas"): AppMetrics {
  return {
    appKey,
    displayName: appKey === "puzzle-canvas" ? "Puzzle Canvas" : appKey,
    generatedAt: "2026-06-02T20:00:00.000Z",
    timezone: "America/Los_Angeles",
    values: {
      users: { total: values.users?.total ?? null },
      downloads: { firstTime: values.downloads?.firstTime ?? null },
      activeUsers: {
        today: values.activeUsers?.today ?? null,
        sevenDays: values.activeUsers?.sevenDays ?? null,
        thirtyDays: values.activeUsers?.thirtyDays ?? null
      },
      subscriptions: {
        monthly: values.subscriptions?.monthly ?? null,
        annual: values.subscriptions?.annual ?? null
      },
      episodeCompletionStats: {
        median: values.episodeCompletionStats?.median ?? null,
        p75: values.episodeCompletionStats?.p75 ?? null,
        max: values.episodeCompletionStats?.max ?? null
      },
      episodeCompletionDistribution:
        values.episodeCompletionDistribution ?? [],
      retention: {
        d1: values.retention?.d1 ?? null,
        d3: values.retention?.d3 ?? null,
        d7: values.retention?.d7 ?? null,
        d14: values.retention?.d14 ?? null
      },
      retentionCurve:
        values.retentionCurve ??
        Array.from({ length: 31 }, (_, day) => ({
          day,
          percentage: null
        })),
      accumulatedSalesUsd: {
        total: values.accumulatedSalesUsd?.total ?? null
      },
      accumulatedAdsEarningsUsd: {
        total: values.accumulatedAdsEarningsUsd?.total ?? null
      },
      subscriptionSalesUsd: {
        today: values.subscriptionSalesUsd?.today ?? null,
        sevenDays: values.subscriptionSalesUsd?.sevenDays ?? null,
        thirtyDays: values.subscriptionSalesUsd?.thirtyDays ?? null
      },
      monthlySubscriptionSalesUsd: {
        today: values.monthlySubscriptionSalesUsd?.today ?? null,
        sevenDays: values.monthlySubscriptionSalesUsd?.sevenDays ?? null,
        thirtyDays: values.monthlySubscriptionSalesUsd?.thirtyDays ?? null
      },
      annualSubscriptionSalesUsd: {
        today: values.annualSubscriptionSalesUsd?.today ?? null,
        sevenDays: values.annualSubscriptionSalesUsd?.sevenDays ?? null,
        thirtyDays: values.annualSubscriptionSalesUsd?.thirtyDays ?? null
      },
      adsEarningsUsd: {
        today: values.adsEarningsUsd?.today ?? null,
        sevenDays: values.adsEarningsUsd?.sevenDays ?? null,
        thirtyDays: values.adsEarningsUsd?.thirtyDays ?? null
      },
      adsEcpmUsd: {
        today: values.adsEcpmUsd?.today ?? null,
        sevenDays: values.adsEcpmUsd?.sevenDays ?? null,
        thirtyDays: values.adsEcpmUsd?.thirtyDays ?? null
      },
      consumableRevenueUsd: {
        today: values.consumableRevenueUsd?.today ?? null,
        sevenDays: values.consumableRevenueUsd?.sevenDays ?? null,
        thirtyDays: values.consumableRevenueUsd?.thirtyDays ?? null
      },
      dailyMetrics: values.dailyMetrics ?? []
    },
    productSales: [],
    sourceStatuses: {
      firestore: { ok: true, message: "ok" },
      appStore: { ok: true, message: "ok" },
      ads: { ok: true, message: "ok" },
      analytics: { ok: true, message: "ok" },
      snapshot: { ok: true, message: "ok" }
    }
  };
}

describe("snapshot totals", () => {
  it("calculates median, 75th percentile, and maximum completed episodes", () => {
    expect(summarizeEpisodeCompletions([])).toEqual({ median: null, p75: null, max: null });
    expect(summarizeEpisodeCompletions([9, 2, 5])).toEqual({ median: 5, p75: 7, max: 9 });
    expect(summarizeEpisodeCompletions([10, 2, 4, 8])).toEqual({ median: 6, p75: 8.5, max: 10 });
  });

  it("builds an episode-completion frequency histogram with readable tail buckets", () => {
    const distribution = episodeCompletionDistribution([0, 1, 5, 6, 10, 20, 22, 40, 48, 75, 100, 149, 150, 258]);
    expect(distribution).toHaveLength(12);
    expect(distribution[0]).toEqual({ label: "0", minEpisodes: 0, maxEpisodes: 0, users: 1 });
    expect(distribution[1]).toEqual({ label: "1-5", minEpisodes: 1, maxEpisodes: 5, users: 2 });
    expect(distribution[2]).toEqual({ label: "6-10", minEpisodes: 6, maxEpisodes: 10, users: 2 });
    expect(distribution[3]).toEqual({ label: "11-20", minEpisodes: 11, maxEpisodes: 20, users: 1 });
    expect(distribution[4]).toEqual({ label: "21-30", minEpisodes: 21, maxEpisodes: 30, users: 1 });
    expect(distribution[5]).toEqual({ label: "31-40", minEpisodes: 31, maxEpisodes: 40, users: 1 });
    expect(distribution[6]).toEqual({ label: "41-50", minEpisodes: 41, maxEpisodes: 50, users: 1 });
    expect(distribution[7]).toEqual({ label: "51-100", minEpisodes: 51, maxEpisodes: 100, users: 2 });
    expect(distribution[8]).toEqual({ label: "101-150", minEpisodes: 101, maxEpisodes: 150, users: 2 });
    expect(distribution[9]).toEqual({ label: "151-200", minEpisodes: 151, maxEpisodes: 200, users: 0 });
    expect(distribution[10]).toEqual({ label: "201-250", minEpisodes: 201, maxEpisodes: 250, users: 0 });
    expect(distribution[11]).toEqual({ label: "251+", minEpisodes: 251, maxEpisodes: null, users: 1 });
  });

  it("uses only explicit numeric episode totals from schema version 3 or later", () => {
    expect(episodeCompletionValue(3, 12)).toBe(12);
    expect(episodeCompletionValue(4, 0)).toBe(0);
    expect(episodeCompletionValue(2, 12)).toBeNull();
    expect(episodeCompletionValue("3", 12)).toBeNull();
    expect(episodeCompletionValue(3, "12")).toBeNull();
    expect(episodeCompletionValue(3, undefined)).toBeNull();
  });

  it("recognizes sandbox transaction environments", () => {
    expect(isSandboxEnvironment("Sandbox")).toBe(true);
    expect(isSandboxEnvironment("sandbox")).toBe(true);
    expect(isSandboxEnvironment("Production")).toBe(false);
    expect(isSandboxEnvironment(undefined)).toBe(false);
    expect(isProductionEnvironment("Production")).toBe(true);
    expect(isProductionEnvironment(" production ")).toBe(true);
    expect(isProductionEnvironment("Sandbox")).toBe(false);
    expect(isProductionEnvironment(null)).toBe(false);
  });

  it("sums portfolio metric values", () => {
    const totals = sumMetricValues([
      appMetric({
        downloads: { firstTime: 10 },
        users: { total: 12 },
        activeUsers: { today: 2, sevenDays: 5, thirtyDays: 7 },
        subscriptions: { monthly: 1, annual: 2 },
        accumulatedSalesUsd: { total: 9.99 },
        accumulatedAdsEarningsUsd: { total: 12 },
        subscriptionSalesUsd: { today: 4.99, sevenDays: 9.98, thirtyDays: 19.96 },
        monthlySubscriptionSalesUsd: { today: 1.99, sevenDays: 3.98, thirtyDays: 9.95 },
        annualSubscriptionSalesUsd: { today: 19.99, sevenDays: 19.99, thirtyDays: 39.98 },
        adsEarningsUsd: { today: 1.25, sevenDays: 3.5, thirtyDays: 7.75 },
        adsEcpmUsd: { today: 2, sevenDays: 4, thirtyDays: 6 },
        consumableRevenueUsd: { today: 1.99, sevenDays: 2.5, thirtyDays: 3.75 },
        dailyMetrics: [{ date: "2026-06-01", users: 2, subscribers: 1, activeUsers: 2, iapSalesUsd: 1.99, adsEarningsUsd: 0.5 }]
      }),
      appMetric({
        downloads: { firstTime: 4 },
        users: { total: 5 },
        activeUsers: { today: 3, sevenDays: 6, thirtyDays: 8 },
        subscriptions: { monthly: 3, annual: 4 },
        accumulatedSalesUsd: { total: 2.5 },
        accumulatedAdsEarningsUsd: { total: 3.5 },
        subscriptionSalesUsd: { today: 1, sevenDays: 2, thirtyDays: 3 },
        monthlySubscriptionSalesUsd: { today: 1.99, sevenDays: 1.99, thirtyDays: 5.97 },
        annualSubscriptionSalesUsd: { today: 0, sevenDays: 19.99, thirtyDays: 19.99 },
        adsEarningsUsd: { today: 2.25, sevenDays: 4.5, thirtyDays: 8.25 },
        adsEcpmUsd: { today: 3, sevenDays: 5, thirtyDays: 7 },
        consumableRevenueUsd: { today: 2.01, sevenDays: 2.5, thirtyDays: 4.25 },
        dailyMetrics: [{ date: "2026-06-01", users: 3, subscribers: 2, activeUsers: 1, iapSalesUsd: 2.01, adsEarningsUsd: 0.25 }]
      })
    ]);

    expect(totals.downloads.firstTime).toBe(14);
    expect(totals.users.total).toBe(17);
    expect(totals.activeUsers.today).toBe(5);
    expect(totals.subscriptions.annual).toBe(6);
    expect(totals.accumulatedSalesUsd.total).toBe(12.49);
    expect(totals.accumulatedAdsEarningsUsd.total).toBe(15.5);
    expect(totals.subscriptionSalesUsd.today).toBe(5.99);
    expect(totals.subscriptionSalesUsd.thirtyDays).toBe(22.96);
    expect(totals.monthlySubscriptionSalesUsd.today).toBe(3.98);
    expect(totals.monthlySubscriptionSalesUsd.thirtyDays).toBe(15.92);
    expect(totals.annualSubscriptionSalesUsd.sevenDays).toBe(39.98);
    expect(totals.annualSubscriptionSalesUsd.thirtyDays).toBe(59.97);
    expect(totals.adsEarningsUsd.today).toBe(3.5);
    expect(totals.adsEcpmUsd.thirtyDays).toBe(13);
    expect(totals.consumableRevenueUsd.today).toBe(4);
    expect(totals.consumableRevenueUsd.thirtyDays).toBe(8);
    expect(totals.dailyMetrics[0]).toMatchObject({
      date: "2026-06-01",
      users: 3,
      subscribers: 2,
      activeUsers: 1,
      iapSalesUsd: 2.01,
      adsEarningsUsd: 0.25
    });
  });

  it("writes per-app historical daily docs without erasing existing non-null values", async () => {
    const db = new FakeFirestore();
    const first = appMetric({
      dailyMetrics: [
        {
          date: "2026-06-01",
          users: 4,
          subscribers: 1,
          activeUsers: 2,
          onboardedUsers: 12,
          iapSalesUsd: 5,
          goldPackSalesUsd: 2,
          adsEarningsUsd: 0.5
        }
      ]
    });
    const second = appMetric({
      dailyMetrics: [
        {
          date: "2026-06-01",
          users: 5,
          subscribers: 2,
          activeUsers: 3,
          onboardedUsers: null,
          iapSalesUsd: 7,
          goldPackSalesUsd: null,
          adsEarningsUsd: null
        }
      ]
    });

    await writeLatestSnapshot(db as never, [first]);
    await writeLatestSnapshot(db as never, [second]);

    expect(db.store.get("puzzleCanvas/dashboard/dailyMetrics/2026-06-01")).toMatchObject({
      schemaVersion: 2,
      appKey: "puzzle-canvas",
      users: 5,
      subscribers: 2,
      activeUsers: 3,
      onboardedUsers: 12,
      iapSalesUsd: 7,
      goldPackSalesUsd: 2,
      adsEarningsUsd: 0.5
    });
    expect(db.store.get("puzzleCanvas/dashboard")).toMatchObject({
      summary: {
        values: {
          dailyMetrics: [
            expect.objectContaining({
              date: "2026-06-01",
              onboardedUsers: 12
            })
          ]
        }
      }
    });

    const snapshots = await readLatestSnapshots(db as never);
    expect(snapshots[0].values.dailyMetrics[0]).toMatchObject({
      date: "2026-06-01",
      users: 5,
      onboardedUsers: 12,
      goldPackSalesUsd: 2,
      adsEarningsUsd: 0.5
    });
  });

  it("preserves app-specific daily history for Receipt Cam and Savory Advisor charts", async () => {
    const db = new FakeFirestore();

    await writeLatestSnapshot(db as never, [
      appMetric(
        {
          dailyMetrics: [{ date: "2026-06-01", users: 50, subscribers: 3, activeUsers: 4, iapSalesUsd: 19.99 }]
        },
        "receipt-cam"
      ),
      appMetric(
        {
          dailyMetrics: [{ date: "2026-06-01", users: 12, subscribers: 2, activeUsers: 5, iapSalesUsd: 6.98 }]
        },
        "savory-advisor"
      )
    ]);

    expect(db.store.get("receiptCam/dashboard/dailyMetrics/2026-06-01")).toMatchObject({
      appKey: "receipt-cam",
      users: 50,
      subscribers: 3,
      activeUsers: 4,
      iapSalesUsd: 19.99
    });
    expect(db.store.get("savoryAdvisor/dashboard/dailyMetrics/2026-06-01")).toMatchObject({
      appKey: "savory-advisor",
      users: 12,
      subscribers: 2,
      activeUsers: 5,
      iapSalesUsd: 6.98
    });
  });
});
