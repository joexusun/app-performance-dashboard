import { Timestamp, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { AppConfig, ProductSalesConfig } from "@/lib/server/config";
import type { DailyMetricPoint, DailyMetricValueKey, MetricValues, MetricWindow, ProductSalesMetric } from "@/lib/shared/types";
import { EMPTY_VALUES } from "@/lib/shared/types";
import { getPastThirtyDayKeys, getPastThirtyDayRange, ptDateKey, toPacificTimestampString, type WindowRange } from "@/lib/server/dateWindows";

function cloneEmptyValues(): MetricValues {
  return structuredClone(EMPTY_VALUES);
}

function valueAsNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function dateKeyFromValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return ptDateKey(new Date(value));
  }
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] ?? null;
  }
  if (value instanceof Timestamp) {
    return ptDateKey(value.toDate());
  }
  if (value instanceof Date) {
    return ptDateKey(value);
  }
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate() as unknown;
    return date instanceof Date ? ptDateKey(date) : null;
  }
  return null;
}

function millisFromValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Timestamp) {
    return value.toMillis();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate() as unknown;
    return date instanceof Date ? date.getTime() : null;
  }
  return null;
}

function dateKeyCompare(left: string | null, right: string): number {
  if (!left) return Number.NEGATIVE_INFINITY;
  return left.localeCompare(right);
}

function subscriptionActiveOnDate(expiryValue: unknown, date: string, currentlySubscribed: boolean): boolean {
  const expiryDate = dateKeyFromValue(expiryValue);
  if (!expiryDate) return currentlySubscribed;

  if (date === ptDateKey(new Date())) {
    const expiresAt = millisFromValue(expiryValue);
    return expiresAt === null ? currentlySubscribed : expiresAt > Date.now();
  }

  return dateKeyCompare(expiryDate, date) >= 0;
}

function isSandboxUserDoc(app: AppConfig, doc: QueryDocumentSnapshot): boolean {
  const { sandboxField, sandboxValue } = app.mapping.users;
  return Boolean(sandboxField && sandboxValue !== null && doc.get(sandboxField) === sandboxValue);
}

function isOnboardedUserDoc(app: AppConfig, doc: QueryDocumentSnapshot): boolean {
  const { onboardedField, onboardedValue } = app.mapping.users;
  if (!onboardedField) return false;
  if (doc.get(onboardedField) === onboardedValue) return true;
  // Legacy fallback: nested tutorial.passed === true.
  const legacyTutorial = doc.get("tutorial");
  return Boolean(legacyTutorial && typeof legacyTutorial === "object" && (legacyTutorial as { passed?: unknown }).passed === true);
}

function emptyDailyMetrics(): DailyMetricPoint[] {
  return getPastThirtyDayKeys().map((date) => ({
    date,
    users: 0,
    subscribers: 0,
    activeUsers: 0,
    onboardedUsers: null,
    iapSalesUsd: 0,
    adsEarningsUsd: null
  }));
}

function dailyProductField(product: ProductSalesConfig): DailyMetricValueKey | null {
  if (product.key === "goldPack") return "goldPackSalesUsd";
  if (product.key === "newCanvas") return "newCanvasSalesUsd";
  if (product.key === "assistRefillMembers") return "assistRefillMemberSalesUsd";
  if (product.key === "assistRefillNonMembers") return "assistRefillNonMemberSalesUsd";
  return null;
}

async function countActiveUsers(db: Firestore, app: AppConfig, window: WindowRange): Promise<number> {
  const { collection, timestampField, timestampType, userField } = app.mapping.activity;
  const start = timestampType === "pacific-string" ? toPacificTimestampString(window.start) : Timestamp.fromDate(window.start);
  const end = timestampType === "pacific-string" ? toPacificTimestampString(window.end) : Timestamp.fromDate(window.end);
  const snapshot = await db
    .collection(collection)
    .where(timestampField, ">=", start)
    .where(timestampField, "<=", end)
    .get();

  const users = new Set<string>();
  snapshot.forEach((doc) => {
    const value = userField === "__docId" ? doc.id : doc.get(userField);
    if (typeof value === "string" && value.trim()) users.add(value);
  });

  return users.size;
}

async function countTotalUsers(db: Firestore, app: AppConfig): Promise<number | null> {
  const { collection, sandboxField, sandboxValue } = app.mapping.users;
  if (!collection) return null;

  const snapshot = await db.collection(collection).get();
  let total = 0;

  snapshot.forEach((doc) => {
    if (!sandboxField || sandboxValue === null || doc.get(sandboxField) !== sandboxValue) {
      total += 1;
    }
  });

  return total;
}

async function countSubscriptions(db: Firestore, app: AppConfig): Promise<{ monthly: number; annual: number }> {
  const { collection, statusField, productField, expiryDateField, activeValue, monthlyProductIds, annualProductIds } = app.mapping.entitlements;
  const productIds = [...monthlyProductIds, ...annualProductIds];

  if (productIds.length === 0) {
    return { monthly: 0, annual: 0 };
  }

  const snapshot = await db.collection(collection).where(statusField, "==", activeValue).get();
  let monthly = 0;
  let annual = 0;

  snapshot.forEach((doc) => {
    const productId = String(doc.get(productField) ?? "");
    const expiresAt = millisFromValue(doc.get(expiryDateField));
    if (expiresAt !== null && expiresAt <= Date.now()) return;
    if (monthlyProductIds.includes(productId)) monthly += 1;
    if (annualProductIds.includes(productId)) annual += 1;
  });

  return { monthly, annual };
}

function subscriptionProductPrice(app: AppConfig, productId: string): number {
  const override = app.productPricesUsd[productId];
  if (override !== undefined) return override;
  if (app.mapping.entitlements.monthlyProductIds.includes(productId)) {
    return app.monthlyPriceUsd ?? 0;
  }
  if (app.mapping.entitlements.annualProductIds.includes(productId)) {
    return app.annualPriceUsd ?? 0;
  }
  return 0;
}

async function sumReceiptCamAccumulatedSalesRevenue(db: Firestore, app: AppConfig): Promise<number> {
  const productIds = [...app.mapping.entitlements.monthlyProductIds, ...app.mapping.entitlements.annualProductIds];
  if (productIds.length === 0) return 0;

  const snapshot = await db.collectionGroup("events").get();
  const transactionIds = new Set<string>();
  let total = 0;

  snapshot.forEach((doc) => {
    const productId = String(doc.get("productId") ?? "");
    if (!productIds.includes(productId)) return;

    const environment = String(doc.get("environment") ?? "");
    if (/sandbox/i.test(environment)) return;

    const notificationType = String(doc.get("notificationType") ?? "");
    if (!["SUBSCRIBED", "DID_RENEW", "DID_RECOVER"].includes(notificationType)) return;

    const transactionId = String(doc.get("transactionId") ?? doc.id);
    if (!transactionId || transactionIds.has(transactionId)) return;

    transactionIds.add(transactionId);
    total += subscriptionProductPrice(app, productId);
  });

  return Math.round(total * 100) / 100;
}

function emptyWindowMap(): Record<MetricWindow, number> {
  return { today: 0, sevenDays: 0, thirtyDays: 0 };
}

async function sumReceiptCamSubscriptionSalesByTerm(
  db: Firestore,
  app: AppConfig,
  windows: WindowRange[]
): Promise<{ monthly: Record<MetricWindow, number>; annual: Record<MetricWindow, number> }> {
  const monthlyIds = app.mapping.entitlements.monthlyProductIds;
  const annualIds = app.mapping.entitlements.annualProductIds;
  const result = { monthly: emptyWindowMap(), annual: emptyWindowMap() };
  if (monthlyIds.length === 0 && annualIds.length === 0) return result;

  const snapshot = await db.collectionGroup("events").get();
  const transactionIds = new Set<string>();

  snapshot.forEach((doc) => {
    const productId = String(doc.get("productId") ?? "");
    const isMonthly = monthlyIds.includes(productId);
    const isAnnual = annualIds.includes(productId);
    if (!isMonthly && !isAnnual) return;

    const environment = String(doc.get("environment") ?? "");
    if (/sandbox/i.test(environment)) return;

    const notificationType = String(doc.get("notificationType") ?? "");
    if (!["SUBSCRIBED", "DID_RENEW", "DID_RECOVER"].includes(notificationType)) return;

    const transactionId = String(doc.get("transactionId") ?? doc.id);
    if (!transactionId || transactionIds.has(transactionId)) return;
    transactionIds.add(transactionId);

    const millis = millisFromValue(doc.get("signedDate"));
    if (millis === null) return;

    const price = subscriptionProductPrice(app, productId);
    const bucket = isMonthly ? result.monthly : result.annual;
    for (const window of windows) {
      if (millis >= window.start.getTime() && millis <= window.end.getTime()) {
        bucket[window.key] = Math.round((bucket[window.key] + price) * 100) / 100;
      }
    }
  });

  return result;
}

// Savory Advisor stores subscription revenue as Apple App Store Server Notification
// events under appStoreNotificationV2/{originalTransactionId}/events (productId lives on the
// parent doc), and consumable grants in iapTransactions. There is no flat purchases collection.
// Savory subscription charge events. Apple webhook events use eventType; in-app
// verification writes ledger docs whose reason marks an actual charge (begin/renew).
const SAVORY_PAID_EVENT_TYPES = new Set(["started_without_trial", "renewed"]);
const SAVORY_SUBSCRIPTION_CHARGE_REASONS = new Set(["subscription_begin_without_trial", "month_begin"]);

type SavorySaleRecord = { kind: "monthly" | "annual" | "consumable"; price: number; millis: number | null };

function savoryProductPrice(app: AppConfig, productId: string): number {
  if (app.mapping.entitlements.monthlyProductIds.includes(productId)) return app.monthlyPriceUsd ?? 0;
  if (app.mapping.entitlements.annualProductIds.includes(productId)) return app.annualPriceUsd ?? 0;
  const product = app.productSales.find((sale) => sale.productIds.includes(productId));
  return product?.unitPriceUsd ?? 0;
}

function savoryProductKind(app: AppConfig, productId: string): "monthly" | "annual" | "consumable" | null {
  if (app.mapping.entitlements.monthlyProductIds.includes(productId)) return "monthly";
  if (app.mapping.entitlements.annualProductIds.includes(productId)) return "annual";
  if (app.productSales.some((sale) => sale.productIds.includes(productId))) return "consumable";
  return null;
}

async function collectSavorySaleRecords(db: Firestore, app: AppConfig): Promise<SavorySaleRecord[]> {
  // Dedup every Apple transaction once across all sources; prefer a record with a real price.
  const records = new Map<string, SavorySaleRecord>();
  const addRecord = (transactionId: string, record: SavorySaleRecord) => {
    if (!transactionId) return;
    const existing = records.get(transactionId);
    if (!existing || (existing.price <= 0 && record.price > 0)) records.set(transactionId, record);
  };

  // 1. In-app verification ledger (subscription charges + consumables). Prices are often null,
  //    so fall back to configured list prices.
  const ledgerSnapshot = await db.collection("ledger").get();
  ledgerSnapshot.forEach((doc) => {
    const purchaseDetails = doc.get("purchaseDetails") as
      | { transactionId?: string; productId?: string; price?: number | null }
      | undefined;
    if (!purchaseDetails) return;
    const productId = String(purchaseDetails.productId ?? "");
    if (!productId) return;
    const kind = savoryProductKind(app, productId);
    if (!kind) return;
    const reason = String(doc.get("reason") ?? "");
    if ((kind === "monthly" || kind === "annual") && !SAVORY_SUBSCRIPTION_CHARGE_REASONS.has(reason)) return;

    const documentPrice = typeof purchaseDetails.price === "number" ? purchaseDetails.price : 0;
    const price = documentPrice > 0 ? documentPrice : savoryProductPrice(app, productId);
    const transactionId = String(purchaseDetails.transactionId ?? doc.id);
    addRecord(transactionId, { kind, price, millis: millisFromValue(doc.get("timestamp")) });
  });

  // 2. Apple App Store Server Notification events (renewals when webhooks are delivered).
  const productByOriginalTxn = new Map<string, string>();
  const parentSnapshot = await db.collection("appStoreNotificationV2").get();
  parentSnapshot.forEach((doc) => productByOriginalTxn.set(doc.id, String(doc.get("productId") ?? "")));

  const eventsSnapshot = await db.collectionGroup("events").get();
  eventsSnapshot.forEach((doc) => {
    const eventType = String(doc.get("eventType") ?? "");
    if (!SAVORY_PAID_EVENT_TYPES.has(eventType)) return;
    const originalTransactionId = doc.ref.parent.parent?.id ?? "";
    const productId = productByOriginalTxn.get(originalTransactionId);
    if (!productId) return;
    const kind = savoryProductKind(app, productId);
    if (kind !== "monthly" && kind !== "annual") return;
    const priceValue = doc.get("price");
    const price = typeof priceValue === "number" && priceValue > 0 ? priceValue : savoryProductPrice(app, productId);
    const transactionId = String(doc.get("transactionId") ?? doc.id);
    addRecord(transactionId, { kind, price, millis: millisFromValue(doc.get("purchaseDate")) });
  });

  // 3. Consumable purchases recorded only in iapTransactions (no ledger purchaseDetails).
  const iapSnapshot = await db.collection("iapTransactions").get();
  iapSnapshot.forEach((doc) => {
    const productId = String(doc.get("productId") ?? "");
    if (savoryProductKind(app, productId) !== "consumable") return;
    const transactionId = String(doc.get("storeTransactionId") ?? doc.id);
    addRecord(transactionId, { kind: "consumable", price: savoryProductPrice(app, productId), millis: millisFromValue(doc.get("createdAt")) });
  });

  return [...records.values()];
}

async function collectSavoryAdvisorSales(
  db: Firestore,
  app: AppConfig,
  windows: WindowRange[]
): Promise<{ accumulatedUsd: number; monthly: Record<MetricWindow, number>; annual: Record<MetricWindow, number> }> {
  const result = { accumulatedUsd: 0, monthly: emptyWindowMap(), annual: emptyWindowMap() };
  const records = await collectSavorySaleRecords(db, app);

  let total = 0;
  for (const record of records) {
    total += record.price;
    if (record.millis === null || record.kind === "consumable") continue;
    const bucket = record.kind === "monthly" ? result.monthly : result.annual;
    for (const window of windows) {
      if (record.millis >= window.start.getTime() && record.millis <= window.end.getTime()) {
        bucket[window.key] = Math.round((bucket[window.key] + record.price) * 100) / 100;
      }
    }
  }

  result.accumulatedUsd = Math.round(total * 100) / 100;
  return result;
}

async function addSavoryDailyIapSales(db: Firestore, app: AppConfig, byDate: Map<string, DailyMetricPoint>): Promise<void> {
  const records = await collectSavorySaleRecords(db, app);
  for (const record of records) {
    if (record.millis === null) continue;
    const point = byDate.get(ptDateKey(new Date(record.millis)));
    if (!point) continue;
    point.iapSalesUsd = Math.round(((point.iapSalesUsd ?? 0) + record.price) * 100) / 100;
  }
}

async function sumAccumulatedConsumableRevenue(db: Firestore, app: AppConfig): Promise<number> {
  const { collection, amountField, productTypeField, consumableValue } = app.mapping.purchases;
  const snapshot = await db.collection(collection).get();
  let total = 0;

  snapshot.forEach((doc) => {
    if (String(doc.get(productTypeField) ?? "") === consumableValue) {
      total += valueAsNumber(doc.get(amountField));
    }
  });

  return Math.round(total * 100) / 100;
}

async function addReceiptCamDailyIapSales(db: Firestore, app: AppConfig, byDate: Map<string, DailyMetricPoint>): Promise<void> {
  const productIds = [...app.mapping.entitlements.monthlyProductIds, ...app.mapping.entitlements.annualProductIds];
  if (productIds.length === 0) return;

  const snapshot = await db.collectionGroup("events").get();
  const transactionIds = new Set<string>();

  snapshot.forEach((doc) => {
    const productId = String(doc.get("productId") ?? "");
    if (!productIds.includes(productId)) return;

    const environment = String(doc.get("environment") ?? "");
    if (/sandbox/i.test(environment)) return;

    const notificationType = String(doc.get("notificationType") ?? "");
    if (!["SUBSCRIBED", "DID_RENEW", "DID_RECOVER"].includes(notificationType)) return;

    const transactionId = String(doc.get("transactionId") ?? doc.id);
    if (!transactionId || transactionIds.has(transactionId)) return;

    const date = dateKeyFromValue(doc.get("signedDate"));
    const point = date ? byDate.get(date) : null;
    if (!point) return;

    transactionIds.add(transactionId);
    point.iapSalesUsd = Math.round(((point.iapSalesUsd ?? 0) + subscriptionProductPrice(app, productId)) * 100) / 100;
  });
}

async function addDailyConsumableIapSales(db: Firestore, app: AppConfig, byDate: Map<string, DailyMetricPoint>): Promise<void> {
  const thirtyDays = getPastThirtyDayRange();
  const purchaseStart =
    app.mapping.purchases.timestampType === "pacific-string" ? toPacificTimestampString(thirtyDays.start) : Timestamp.fromDate(thirtyDays.start);
  const purchaseEnd =
    app.mapping.purchases.timestampType === "pacific-string" ? toPacificTimestampString(thirtyDays.end) : Timestamp.fromDate(thirtyDays.end);
  const snapshot = await db
    .collection(app.mapping.purchases.collection)
    .where(app.mapping.purchases.timestampField, ">=", purchaseStart)
    .where(app.mapping.purchases.timestampField, "<=", purchaseEnd)
    .get();

  snapshot.forEach((doc) => {
    if (String(doc.get(app.mapping.purchases.productTypeField) ?? "") !== app.mapping.purchases.consumableValue) return;

    const date = dateKeyFromValue(doc.get(app.mapping.purchases.timestampField));
    const point = date ? byDate.get(date) : null;
    if (!point) return;

    point.iapSalesUsd = Math.round(((point.iapSalesUsd ?? 0) + valueAsNumber(doc.get(app.mapping.purchases.amountField))) * 100) / 100;
  });
}

async function sumConsumableRevenue(db: Firestore, app: AppConfig, window: WindowRange): Promise<number> {
  const { collection, timestampField, timestampType, amountField, productTypeField, consumableValue } = app.mapping.purchases;
  const start = timestampType === "pacific-string" ? toPacificTimestampString(window.start) : Timestamp.fromDate(window.start);
  const end = timestampType === "pacific-string" ? toPacificTimestampString(window.end) : Timestamp.fromDate(window.end);
  const snapshot = await db
    .collection(collection)
    .where(timestampField, ">=", start)
    .where(timestampField, "<=", end)
    .get();

  let total = 0;
  snapshot.forEach((doc) => {
    if (String(doc.get(productTypeField) ?? "") === consumableValue) {
      total += valueAsNumber(doc.get(amountField));
    }
  });

  return Math.round(total * 100) / 100;
}

async function sumSubscriptionSalesRevenue(db: Firestore, app: AppConfig, window: WindowRange): Promise<number | null> {
  const productIds = [...app.mapping.entitlements.monthlyProductIds, ...app.mapping.entitlements.annualProductIds];
  if (productIds.length === 0) return null;

  const { collection, timestampField, timestampType, amountField, productField } = app.mapping.purchases;
  const start = timestampType === "pacific-string" ? toPacificTimestampString(window.start) : Timestamp.fromDate(window.start);
  const end = timestampType === "pacific-string" ? toPacificTimestampString(window.end) : Timestamp.fromDate(window.end);
  const snapshot = await db
    .collection(collection)
    .where(timestampField, ">=", start)
    .where(timestampField, "<=", end)
    .get();

  let total = 0;
  snapshot.forEach((doc) => {
    const productId = String(doc.get(productField) ?? "");
    if (productIds.includes(productId)) {
      total += valueAsNumber(doc.get(amountField));
    }
  });

  return Math.round(total * 100) / 100;
}

function fallbackProductPrice(app: AppConfig, productId: string, purchaseKind: string): number {
  const product = app.productSales.find((sale) => {
    const matchesProduct = sale.productIds.includes(productId);
    const matchesKind = sale.purchaseKind ? sale.purchaseKind === purchaseKind : true;
    return matchesProduct && matchesKind;
  });

  return product?.unitPriceUsd ?? subscriptionProductPrice(app, productId);
}

function configuredIapProductIds(app: AppConfig): Set<string> {
  return new Set([
    ...app.mapping.entitlements.monthlyProductIds,
    ...app.mapping.entitlements.annualProductIds,
    ...app.productSales.flatMap((product) => product.productIds)
  ]);
}

function purchaseIapAmount(app: AppConfig, productId: string, purchaseKind: string, amount: unknown): number | null {
  const configuredPurchaseIds = configuredIapProductIds(app);
  const isKnownProduct = configuredPurchaseIds.has(productId);
  const isGenericConsumable = purchaseKind === app.mapping.purchases.consumableValue;

  if (configuredPurchaseIds.size > 0 && !isKnownProduct && !isGenericConsumable) {
    return null;
  }

  const documentAmount = valueAsNumber(amount);
  if (documentAmount > 0) return documentAmount;
  return isKnownProduct ? fallbackProductPrice(app, productId, purchaseKind) : 0;
}

async function sumAccumulatedSalesRevenue(db: Firestore, app: AppConfig): Promise<number> {
  if (app.key === "savory-advisor") {
    // Computed alongside windowed subscription sales in collectFirestoreMetrics.
    return 0;
  }
  if (app.key === "receipt-cam") {
    const subscriptionRevenue = await sumReceiptCamAccumulatedSalesRevenue(db, app);
    const consumableRevenue = await sumAccumulatedConsumableRevenue(db, app);
    return Math.round((subscriptionRevenue + consumableRevenue) * 100) / 100;
  }

  const { collection, amountField, productField, productTypeField } = app.mapping.purchases;
  const snapshot = await db.collection(collection).get();
  let total = 0;

  snapshot.forEach((doc) => {
    const productId = String(doc.get(productField) ?? "");
    const purchaseKind = String(doc.get(productTypeField) ?? "");
    total += purchaseIapAmount(app, productId, purchaseKind, doc.get(amountField)) ?? 0;
  });

  return Math.round(total * 100) / 100;
}

function iapPurchaseAmount(app: AppConfig, productId: string, purchaseKind: string, amount: unknown): number | null {
  return purchaseIapAmount(app, productId, purchaseKind, amount);
}

async function getDailyMetrics(db: Firestore, app: AppConfig): Promise<DailyMetricPoint[]> {
  const dailyMetrics = emptyDailyMetrics();
  const byDate = new Map(dailyMetrics.map((point) => [point.date, point]));
  const thirtyDays = getPastThirtyDayRange();
  const userCollection = app.mapping.users.collection ?? app.mapping.activity.collection;

  let onboardedTotal = 0;
  const userSnapshot = await db.collection(userCollection).get();
  userSnapshot.forEach((doc) => {
    if (isSandboxUserDoc(app, doc)) return;
    const createdAt = dateKeyFromValue(doc.get(app.mapping.users.createdAtField));
    const lastSeenAt = dateKeyFromValue(doc.get(app.mapping.activity.timestampField));
    if (isOnboardedUserDoc(app, doc)) onboardedTotal += 1;
    const productId = String(doc.get(app.mapping.entitlements.productField) ?? "");
    const hasSubscriptionProduct =
      app.mapping.entitlements.monthlyProductIds.includes(productId) || app.mapping.entitlements.annualProductIds.includes(productId);
    const originalPurchaseDate = dateKeyFromValue(doc.get(app.mapping.entitlements.originalPurchaseDateField));
    const expiryValue = doc.get(app.mapping.entitlements.expiryDateField);
    const currentlySubscribed = doc.get(app.mapping.entitlements.statusField) === app.mapping.entitlements.activeValue;

    for (const point of dailyMetrics) {
      if (lastSeenAt === point.date) {
        point.activeUsers = (point.activeUsers ?? 0) + 1;
      }

      if (!createdAt || dateKeyCompare(createdAt, point.date) <= 0) {
        point.users = (point.users ?? 0) + 1;
      }

      if (hasSubscriptionProduct) {
        const started = !originalPurchaseDate || dateKeyCompare(originalPurchaseDate, point.date) <= 0;
        if (started && subscriptionActiveOnDate(expiryValue, point.date, currentlySubscribed)) {
          point.subscribers = (point.subscribers ?? 0) + 1;
        }
      }
    }
  });

  // Onboarded users has no historical timestamp, so only stamp today's snapshot.
  // Past days stay null and future refreshes accumulate a real day-over-day series.
  if (app.mapping.users.onboardedField) {
    const todayPoint = byDate.get(ptDateKey(new Date()));
    if (todayPoint) todayPoint.onboardedUsers = onboardedTotal;
  }

  if (app.key === "receipt-cam") {
    await addReceiptCamDailyIapSales(db, app, byDate);
    await addDailyConsumableIapSales(db, app, byDate);
    return dailyMetrics;
  }

  if (app.key === "savory-advisor") {
    await addSavoryDailyIapSales(db, app, byDate);
    return dailyMetrics;
  }

  const purchaseStart =
    app.mapping.purchases.timestampType === "pacific-string" ? toPacificTimestampString(thirtyDays.start) : Timestamp.fromDate(thirtyDays.start);
  const purchaseEnd =
    app.mapping.purchases.timestampType === "pacific-string" ? toPacificTimestampString(thirtyDays.end) : Timestamp.fromDate(thirtyDays.end);
  const purchaseSnapshot = await db
    .collection(app.mapping.purchases.collection)
    .where(app.mapping.purchases.timestampField, ">=", purchaseStart)
    .where(app.mapping.purchases.timestampField, "<=", purchaseEnd)
    .get();

  purchaseSnapshot.forEach((doc) => {
    const date = dateKeyFromValue(doc.get(app.mapping.purchases.timestampField));
    const point = date ? byDate.get(date) : null;
    if (!point) return;

    const productId = String(doc.get(app.mapping.purchases.productField) ?? "");
    const purchaseKind = String(doc.get(app.mapping.purchases.productTypeField) ?? "");
    const amount = iapPurchaseAmount(app, productId, purchaseKind, doc.get(app.mapping.purchases.amountField));
    if (amount !== null) {
      point.iapSalesUsd = Math.round(((point.iapSalesUsd ?? 0) + amount) * 100) / 100;
    }

    for (const product of app.productSales) {
      const field = dailyProductField(product);
      const matchesProduct = product.productIds.includes(productId);
      const matchesKind = product.purchaseKind ? purchaseKind === product.purchaseKind : true;
      if (!field || !matchesProduct || !matchesKind) continue;

      const documentAmount = valueAsNumber(doc.get(app.mapping.purchases.amountField));
      const productAmount = documentAmount > 0 ? documentAmount : product.unitPriceUsd ?? 0;
      point[field] = Math.round(((point[field] ?? 0) + productAmount) * 100) / 100;
    }
  });

  return dailyMetrics;
}

async function sumProductSalesRevenue(
  db: Firestore,
  app: AppConfig,
  product: ProductSalesConfig,
  window: WindowRange
): Promise<number | null> {
  if (product.productIds.length === 0) return null;

  const { collection, timestampField, timestampType, amountField, productField, productTypeField, consumableValue } = app.mapping.purchases;
  const start = timestampType === "pacific-string" ? toPacificTimestampString(window.start) : Timestamp.fromDate(window.start);
  const end = timestampType === "pacific-string" ? toPacificTimestampString(window.end) : Timestamp.fromDate(window.end);
  const snapshot = await db
    .collection(collection)
    .where(timestampField, ">=", start)
    .where(timestampField, "<=", end)
    .get();

  let total = 0;
  snapshot.forEach((doc) => {
    const productId = String(doc.get(productField) ?? "");
    const purchaseKind = String(doc.get(productTypeField) ?? "");
    const matchesKind = product.purchaseKind ? purchaseKind === product.purchaseKind : purchaseKind === consumableValue;
    if (matchesKind && product.productIds.includes(productId)) {
      const documentAmount = valueAsNumber(doc.get(amountField));
      total += documentAmount > 0 ? documentAmount : product.unitPriceUsd ?? 0;
    }
  });

  return Math.round(total * 100) / 100;
}

function emptyProductSales(product: ProductSalesConfig): ProductSalesMetric {
  return {
    key: product.key,
    label: product.label,
    values: {
      today: null,
      sevenDays: null,
      thirtyDays: null
    }
  };
}

export async function collectFirestoreMetrics(
  db: Firestore,
  app: AppConfig,
  windows: WindowRange[]
): Promise<Pick<
  MetricValues,
  | "users"
  | "activeUsers"
  | "subscriptions"
  | "accumulatedSalesUsd"
  | "subscriptionSalesUsd"
  | "monthlySubscriptionSalesUsd"
  | "annualSubscriptionSalesUsd"
  | "consumableRevenueUsd"
  | "dailyMetrics"
> & {
  productSales: ProductSalesMetric[];
}> {
  const values = cloneEmptyValues();
  values.users.total = await countTotalUsers(db, app);
  values.accumulatedSalesUsd.total = await sumAccumulatedSalesRevenue(db, app);
  values.dailyMetrics = await getDailyMetrics(db, app);
  const activeEntries = await Promise.all(
    windows.map(async (window) => [window.key, await countActiveUsers(db, app, window)] as const)
  );
  const revenueEntries = await Promise.all(
    windows.map(async (window) => [window.key, await sumConsumableRevenue(db, app, window)] as const)
  );
  const subscriptionSalesEntries = await Promise.all(
    windows.map(async (window) => [window.key, await sumSubscriptionSalesRevenue(db, app, window)] as const)
  );
  const productSales = await Promise.all(
    app.productSales.map(async (product) => {
      const metric = emptyProductSales(product);
      const entries = await Promise.all(
        windows.map(async (window) => [window.key, await sumProductSalesRevenue(db, app, product, window)] as const)
      );

      for (const [key, revenue] of entries) {
        metric.values[key] = revenue;
      }

      return metric;
    })
  );
  const subscriptions = await countSubscriptions(db, app);

  for (const [key, count] of activeEntries) {
    values.activeUsers[key as MetricWindow] = count;
  }
  for (const [key, revenue] of revenueEntries) {
    values.consumableRevenueUsd[key as MetricWindow] = revenue;
  }
  for (const [key, revenue] of subscriptionSalesEntries) {
    values.subscriptionSalesUsd[key as MetricWindow] = revenue;
  }

  if (app.key === "receipt-cam") {
    const termSales = await sumReceiptCamSubscriptionSalesByTerm(db, app, windows);
    for (const window of windows) {
      values.monthlySubscriptionSalesUsd[window.key] = termSales.monthly[window.key];
      values.annualSubscriptionSalesUsd[window.key] = termSales.annual[window.key];
    }
  }

  if (app.key === "savory-advisor") {
    const savorySales = await collectSavoryAdvisorSales(db, app, windows);
    values.accumulatedSalesUsd.total = savorySales.accumulatedUsd;
    for (const window of windows) {
      values.monthlySubscriptionSalesUsd[window.key] = savorySales.monthly[window.key];
      values.annualSubscriptionSalesUsd[window.key] = savorySales.annual[window.key];
    }
  }

  values.subscriptions = subscriptions;
  return {
    users: values.users,
    activeUsers: values.activeUsers,
    subscriptions: values.subscriptions,
    accumulatedSalesUsd: values.accumulatedSalesUsd,
    subscriptionSalesUsd: values.subscriptionSalesUsd,
    monthlySubscriptionSalesUsd: values.monthlySubscriptionSalesUsd,
    annualSubscriptionSalesUsd: values.annualSubscriptionSalesUsd,
    consumableRevenueUsd: values.consumableRevenueUsd,
    dailyMetrics: values.dailyMetrics,
    productSales
  };
}
